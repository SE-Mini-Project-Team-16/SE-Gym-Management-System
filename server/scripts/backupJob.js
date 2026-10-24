import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
  verifyRestoredDatabase,
  getBackupDir,
  startDailyBackupJob,
} from "../src/backupJob.js";

const args = process.argv.slice(2);
const command = args[0] || "--backup";

async function findLatestSnapshot(backupDir) {
  const dir = await getBackupDir(backupDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const snapshots = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("snapshot-"))
    .map((e) => e.name)
    .sort();
  if (snapshots.length === 0) return null;
  return path.join(dir, snapshots[snapshots.length - 1]);
}

async function listSnapshots(backupDir) {
  const dir = await getBackupDir(backupDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const snapshots = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("snapshot-"))
    .map((e) => e.name)
    .sort();

  console.log(`Available snapshots in ${dir}:`);
  if (snapshots.length === 0) {
    console.log("  (no snapshots found)");
    return;
  }

  for (const name of snapshots) {
    const metaPath = path.join(dir, name, "metadata.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      console.log(
        `  ${meta.snapshotId} | ${meta.timestamp} | Docs: ${meta.totalDocuments} | Collections: ${meta.totalCollections} | Checksum: ${meta.checksum.slice(0, 12)}…`,
      );
    } else {
      console.log(`  ${name} (metadata missing)`);
    }
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri && command !== "--list") {
    throw new Error("MONGODB_URI environment variable is required.");
  }

  if (command === "--list") {
    await listSnapshots();
    return;
  }

  if (command === "--schedule") {
    console.log("Connecting to MongoDB for scheduled daily backup daemon...");
    await mongoose.connect(mongoUri);
    console.log("Starting automated daily backup scheduler (NFR-2)...");
    const job = startDailyBackupJob({
      runImmediately: true,
      onSuccess: (res) =>
        console.log(
          `[${new Date().toISOString()}] Backup completed successfully: ${res.snapshotId} (${res.totalDocuments} docs).`,
        ),
      onError: (err) =>
        console.error(
          `[${new Date().toISOString()}] Backup failed: ${err.message}`,
        ),
    });

    const shutdown = async () => {
      console.log("Stopping scheduled backup job...");
      job.stop();
      await mongoose.disconnect();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  try {
    await mongoose.connect(mongoUri);

    if (command === "--backup") {
      console.log("Initiating database backup...");
      const result = await createBackup();
      console.log("✓ Backup snapshot created successfully:");
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "--restore") {
      let targetPath = args[1];
      if (!targetPath) {
        targetPath = await findLatestSnapshot();
        if (!targetPath) {
          throw new Error("No backup snapshot found to restore.");
        }
        console.log(`Using latest snapshot: ${targetPath}`);
      }
      console.log(`Restoring database from: ${targetPath}...`);
      const restoreResult = await restoreBackup(targetPath, { dropExisting: true });
      console.log("Verifying restored database records (TC-REL-01)...");
      const verifyResult = await verifyRestoredDatabase(targetPath);
      console.log("✓ Database restore and integrity verification completed successfully:");
      console.log(JSON.stringify({ restoreResult, verifyResult }, null, 2));
    } else if (command === "--verify") {
      let targetPath = args[1];
      if (!targetPath) {
        targetPath = await findLatestSnapshot();
        if (!targetPath) {
          throw new Error("No backup snapshot found to verify.");
        }
        console.log(`Verifying latest snapshot: ${targetPath}`);
      }
      const verifyResult = await verifyBackup(targetPath);
      console.log("✓ Snapshot integrity verification passed (SHA-256 match):");
      console.log(JSON.stringify(verifyResult, null, 2));
    } else {
      console.error(`Unknown command: ${command}`);
      console.log("Usage: node backupJob.js [--backup | --restore [path] | --verify [path] | --list | --schedule]");
      process.exit(1);
    }
  } finally {
    if (command !== "--schedule") {
      await mongoose.disconnect();
    }
  }
}

main().catch((err) => {
  console.error("Error executing backup job:", err.message);
  process.exit(1);
});
