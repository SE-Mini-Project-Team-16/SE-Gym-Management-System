import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { EJSON } from "bson";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Computes SHA-256 digest of a Buffer or string.
 */
export function computeSha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Resolves the backup root directory. Enforces restricted directory permissions (0700).
 */
export async function getBackupDir(customDir) {
  const dir = path.resolve(
    customDir || process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),
  );
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // Non-fatal on platforms that do not support POSIX permission bits
  }
  return dir;
}

/**
 * Creates an automated, tamper-evident backup snapshot of all non-system MongoDB collections.
 * Fulfills NFR-2, TC-REL-01, and SV-10 (safe storage, SHA-256 verification, automated pruning).
 */
export async function createBackup(options = {}) {
  const connection = options.connection || mongoose.connection;
  if (!connection || connection.readyState !== 1) {
    throw new Error("Active database connection is required to create a backup.");
  }

  const baseDir = await getBackupDir(options.backupDir);
  const timestamp = new Date();
  const snapshotId = `snapshot-${timestamp.toISOString().replace(/[:.]/g, "-")}`;
  const snapshotPath = path.join(baseDir, snapshotId);

  await fs.mkdir(snapshotPath, { recursive: true, mode: 0o700 });

  const db = connection.db;
  const dbName = db.databaseName;
  const rawCollections = await db.listCollections().toArray();
  const collectionsToBackup = rawCollections
    .map((c) => c.name)
    .filter((name) => !name.startsWith("system."));

  const collectionMetadata = {};
  let totalDocuments = 0;
  let totalRawBytes = 0;

  for (const colName of collectionsToBackup) {
    const col = db.collection(colName);
    const docs = await col.find({}).toArray();
    const rawIndexes = await col.indexes();
    const customIndexes = rawIndexes
      .filter((idx) => idx.name !== "_id_")
      .map(({ v, ns, ...rest }) => rest);

    const serialized = EJSON.stringify(docs);
    const uncompressedBuffer = Buffer.from(serialized, "utf-8");
    const compressedBuffer = await gzip(uncompressedBuffer);
    const fileChecksum = computeSha256(compressedBuffer);

    const fileName = `${colName}.json.gz`;
    const filePath = path.join(snapshotPath, fileName);

    await fs.writeFile(filePath, compressedBuffer, { mode: 0o600 });

    collectionMetadata[colName] = {
      count: docs.length,
      file: fileName,
      sha256: fileChecksum,
      indexes: customIndexes,
      sizeBytes: compressedBuffer.byteLength,
    };

    totalDocuments += docs.length;
    totalRawBytes += uncompressedBuffer.byteLength;
  }

  const combinedChecksum = computeSha256(
    Object.entries(collectionMetadata)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, meta]) => `${name}:${meta.sha256}`)
      .join(";"),
  );

  const metadata = {
    version: "1.0",
    snapshotId,
    timestamp: timestamp.toISOString(),
    database: dbName,
    totalDocuments,
    totalCollections: collectionsToBackup.length,
    checksum: combinedChecksum,
    collections: collectionMetadata,
  };

  const metadataPath = path.join(snapshotPath, "metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), {
    mode: 0o600,
  });

  // Automatically enforce retention policy: prune old snapshots exceeding threshold
  const retentionDays =
    options.retentionDays !== undefined
      ? options.retentionDays
      : Number(process.env.BACKUP_RETENTION_DAYS || 7);
  const prunedSnapshots = await pruneOldSnapshots(baseDir, retentionDays);

  return {
    snapshotId,
    snapshotPath,
    timestamp: metadata.timestamp,
    database: dbName,
    totalCollections: collectionsToBackup.length,
    totalDocuments,
    checksum: combinedChecksum,
    prunedSnapshots,
  };
}

/**
 * Validates integrity of a snapshot by verifying SHA-256 checksums of all archives.
 */
export async function verifyBackup(snapshotPath) {
  const metadataPath = path.join(snapshotPath, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error(`Snapshot metadata not found at: ${metadataPath}`);
  }

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8"));
  for (const [colName, colMeta] of Object.entries(metadata.collections)) {
    const filePath = path.join(snapshotPath, colMeta.file);
    if (!existsSync(filePath)) {
      throw new Error(`Collection archive missing: ${colMeta.file}`);
    }
    const data = await fs.readFile(filePath);
    const computed = computeSha256(data);
    if (computed !== colMeta.sha256) {
      throw new Error(
        `Checksum mismatch for collection ${colName}. Expected ${colMeta.sha256}, got ${computed}`,
      );
    }
  }

  const calculatedCombined = computeSha256(
    Object.entries(metadata.collections)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, meta]) => `${name}:${meta.sha256}`)
      .join(";"),
  );

  if (calculatedCombined !== metadata.checksum) {
    throw new Error("Snapshot overall checksum verification failed.");
  }

  return {
    valid: true,
    snapshotId: metadata.snapshotId,
    timestamp: metadata.timestamp,
    database: metadata.database,
    totalCollections: metadata.totalCollections,
    totalDocuments: metadata.totalDocuments,
  };
}

/**
 * Restores a snapshot into the connected database.
 * Fulfills TC-REL-01 and ST-07 (verifies clean restore, restores collections, documents, and indexes).
 */
export async function restoreBackup(snapshotPath, options = {}) {
  const connection = options.connection || mongoose.connection;
  if (!connection || connection.readyState !== 1) {
    throw new Error("Active database connection is required to restore a backup.");
  }

  // Pre-verification: Ensure all checksums match before touching any database collection
  await verifyBackup(snapshotPath);

  const metadataPath = path.join(snapshotPath, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8"));
  const db = connection.db;

  const dropExisting = options.dropExisting !== undefined ? options.dropExisting : true;
  let totalRestored = 0;
  const restoredCollections = [];

  for (const [colName, colMeta] of Object.entries(metadata.collections)) {
    const filePath = path.join(snapshotPath, colMeta.file);
    const compressed = await fs.readFile(filePath);
    const decompressed = await gunzip(compressed);
    const docs = EJSON.parse(decompressed.toString("utf-8"));

    const col = db.collection(colName);
    if (dropExisting) {
      try {
        await col.drop();
      } catch (err) {
        // Code 26: NamespaceNotFound - collection did not exist yet, safe to ignore
        if (err.code !== 26) throw err;
      }
    }

    if (Array.isArray(docs) && docs.length > 0) {
      await col.insertMany(docs, { ordered: true });
    }

    // Restore custom indexes
    if (Array.isArray(colMeta.indexes) && colMeta.indexes.length > 0) {
      for (const idx of colMeta.indexes) {
        try {
          const { key, ...idxOptions } = idx;
          await col.createIndex(key, idxOptions);
        } catch (idxErr) {
          // Non-fatal if index exists
          console.warn(`Warning restoring index on ${colName}:`, idxErr.message);
        }
      }
    }

    totalRestored += docs.length;
    restoredCollections.push({
      name: colName,
      restoredCount: docs.length,
      expectedCount: colMeta.count,
    });
  }

  return {
    success: true,
    snapshotId: metadata.snapshotId,
    restoredCollections,
    totalRestoredDocuments: totalRestored,
  };
}

/**
 * Verifies that a restored database matches the snapshot records and document counts (TC-REL-01).
 */
export async function verifyRestoredDatabase(snapshotPath, connection = mongoose.connection) {
  const metadataPath = path.join(snapshotPath, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8"));
  const db = connection.db;

  for (const [colName, colMeta] of Object.entries(metadata.collections)) {
    const currentCount = await db.collection(colName).countDocuments();
    if (currentCount !== colMeta.count) {
      throw new Error(
        `Verification failed for ${colName}: expected ${colMeta.count} documents, found ${currentCount}`,
      );
    }
  }

  return {
    verified: true,
    totalCollections: metadata.totalCollections,
    totalDocuments: metadata.totalDocuments,
  };
}

/**
 * Prunes snapshots older than retentionDays. Always preserves at least the latest snapshot.
 */
export async function pruneOldSnapshots(backupDir, retentionDays = 7) {
  if (retentionDays <= 0) return [];
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const snapshotDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("snapshot-"))
    .map((e) => e.name)
    .sort();

  if (snapshotDirs.length <= 1) return [];

  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const pruned = [];

  // Never prune the most recent snapshot regardless of age
  const candidates = snapshotDirs.slice(0, snapshotDirs.length - 1);

  for (const dirName of candidates) {
    const fullPath = path.join(backupDir, dirName);
    const metaPath = path.join(fullPath, "metadata.json");
    let timestamp = null;

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
        timestamp = new Date(meta.timestamp).getTime();
      } catch {
        timestamp = null;
      }
    }

    if (!timestamp) {
      const stats = await fs.stat(fullPath);
      timestamp = stats.mtimeMs;
    }

    if (timestamp < cutoffTime) {
      await fs.rm(fullPath, { recursive: true, force: true });
      pruned.push(dirName);
    }
  }

  return pruned;
}

/**
 * Starts automated daily backup job scheduler.
 * Fulfills NFR-2 (automated daily execution).
 */
export function startDailyBackupJob(options = {}) {
  const intervalMs =
    options.intervalMs ||
    Number(process.env.BACKUP_INTERVAL_HOURS || 24) * 60 * 60 * 1000;
  let timer = null;
  let running = false;
  let lastRun = null;
  let lastError = null;

  async function run() {
    if (running) return;
    running = true;
    try {
      const result = await createBackup(options);
      lastRun = {
        timestamp: new Date().toISOString(),
        snapshotId: result.snapshotId,
        totalDocuments: result.totalDocuments,
      };
      lastError = null;
      if (options.onSuccess) options.onSuccess(result);
    } catch (err) {
      lastError = {
        timestamp: new Date().toISOString(),
        message: err.message,
      };
      if (options.onError) options.onError(err);
    } finally {
      running = false;
    }
  }

  // Calculate next run: immediate if requested, else initial delay or interval
  if (options.runImmediately) {
    run().catch(() => {});
  }

  timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow: () => run(),
    getStatus: () => ({
      active: timer !== null,
      running,
      intervalMs,
      lastRun,
      lastError,
    }),
  };
}
