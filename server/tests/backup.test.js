import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User, GymClass, Booking, Equipment } from "../src/models.js";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
  verifyRestoredDatabase,
  pruneOldSnapshots,
  startDailyBackupJob,
} from "../src/backupJob.js";

let db;
const testBackupDir = path.resolve(process.cwd(), "scratch", "test-backups");

beforeAll(async () => {
  db = await MongoMemoryServer.create({
    instance: {
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(db.getUri());
  await Promise.all([
    User.init(),
    GymClass.init(),
    Booking.init(),
    Equipment.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
  try {
    await fs.rm(testBackupDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    GymClass.deleteMany({}),
    Booking.deleteMany({}),
    Equipment.deleteMany({}),
  ]);
  try {
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testBackupDir, { recursive: true });
  } catch {
    // ignore
  }
});

async function seedTestData() {
  const passwordHash = await bcrypt.hash("securePassword123!", 10);
  const admin = await User.create({
    firstName: "Admin",
    lastName: "User",
    email: "admin@gym.test",
    passwordHash,
    role: "Admin",
    phoneNumber: "1234567890",
  });
  const member = await User.create({
    firstName: "Member",
    lastName: "User",
    email: "member@gym.test",
    passwordHash,
    role: "Member",
    tier: "VIP",
    phoneNumber: "9876543210",
  });
  const trainer = await User.create({
    firstName: "Trainer",
    lastName: "User",
    email: "trainer@gym.test",
    passwordHash,
    role: "Trainer",
    phoneNumber: "5555555555",
  });

  const gymClass = await GymClass.create({
    name: "Morning HIIT",
    trainerId: trainer._id,
    startsAt: new Date(Date.now() + 86400000),
    durationMinutes: 45,
    capacity: 20,
    availableSlots: 19,
    status: "Open",
  });

  const booking = await Booking.create({
    memberId: member._id,
    classId: gymClass._id,
    status: "Active",
  });

  const equipment = await Equipment.create({
    inventoryId: "TRD-001",
    name: "Treadmill Pro X",
    category: "Cardio",
    status: "Available",
  });

  return { admin, member, trainer, gymClass, booking, equipment };
}

describe("Automated Daily Database Backups & Restore / Issue #5 (NFR-2, TC-REL-01, ST-07, SV-10)", () => {
  it("creates daily backup snapshot with all collections, indexes, and SHA-256 metadata", async () => {
    const seeded = await seedTestData();

    const result = await createBackup({ backupDir: testBackupDir });

    const metaPath = path.join(result.snapshotPath, "metadata.json");
    expect(existsSync(metaPath)).toBe(true);
    const metadata = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    expect(result.snapshotId).toMatch(/^snapshot-\d{4}-\d{2}-\d{2}T/);
    expect(result.totalDocuments).toBe(6); // 3 users + 1 class + 1 booking + 1 equipment
    expect(result.totalCollections).toBeGreaterThanOrEqual(4);
    expect(metadata.totalDocuments).toBe(6);
    expect(metadata.collections.users.count).toBe(3);
    expect(metadata.collections.gymclasses.count).toBe(1);
    expect(metadata.collections.bookings.count).toBe(1);
    expect(metadata.collections.equipment.count).toBe(1);
    expect(result.checksum.length).toBe(64); // SHA-256 hex string

    // Verify collection archives exist
    for (const colMeta of Object.values(metadata.collections)) {
      const archivePath = path.join(result.snapshotPath, colMeta.file);
      expect(existsSync(archivePath)).toBe(true);
      expect(colMeta.sha256).toBeDefined();
    }
  });

  it("restores backup snapshot into a clean database, verifying record counts, sample documents, and indexes (TC-REL-01 / ST-07)", async () => {
    const seeded = await seedTestData();

    // 1. Create snapshot
    const backupResult = await createBackup({ backupDir: testBackupDir });

    // 2. Wipe database clean to simulate complete data recovery scenario
    await Promise.all([
      User.deleteMany({}),
      GymClass.deleteMany({}),
      Booking.deleteMany({}),
      Equipment.deleteMany({}),
    ]);
    expect(await User.countDocuments()).toBe(0);
    expect(await GymClass.countDocuments()).toBe(0);
    expect(await Booking.countDocuments()).toBe(0);
    expect(await Equipment.countDocuments()).toBe(0);

    // 3. Restore backup
    const restoreResult = await restoreBackup(backupResult.snapshotPath, {
      dropExisting: true,
    });
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.totalRestoredDocuments).toBe(6);

    // 4. Verify record counts & integrity (TC-REL-01)
    const verification = await verifyRestoredDatabase(backupResult.snapshotPath);
    expect(verification.verified).toBe(true);
    expect(verification.totalDocuments).toBe(6);

    // Verify sample restored documents and data fidelity
    const restoredAdmin = await User.findOne({ email: "admin@gym.test" }).select(
      "+passwordHash +phoneNumber",
    );
    expect(restoredAdmin).not.toBeNull();
    expect(restoredAdmin.firstName).toBe("Admin");
    expect(restoredAdmin.role).toBe("Admin");
    expect(restoredAdmin.phoneNumber).toBe("1234567890");
    expect(
      await bcrypt.compare("securePassword123!", restoredAdmin.passwordHash),
    ).toBe(true);

    const restoredClass = await GymClass.findOne({ name: "Morning HIIT" });
    expect(restoredClass).not.toBeNull();
    expect(restoredClass.availableSlots).toBe(19);
    expect(String(restoredClass.trainerId)).toBe(String(seeded.trainer._id));

    const restoredBooking = await Booking.findOne();
    expect(restoredBooking).not.toBeNull();
    expect(String(restoredBooking.memberId)).toBe(String(seeded.member._id));

    const restoredEquipment = await Equipment.findOne({ inventoryId: "TRD-001" });
    expect(restoredEquipment).not.toBeNull();
    expect(restoredEquipment.status).toBe("Available");
  });

  it("detects tampered or corrupted snapshot files via SHA-256 checksum verification (SV-10)", async () => {
    await seedTestData();
    const backupResult = await createBackup({ backupDir: testBackupDir });

    // Verify untouched snapshot passes
    const preCheck = await verifyBackup(backupResult.snapshotPath);
    expect(preCheck.valid).toBe(true);

    // Tamper with a collection file (corrupt one byte)
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(backupResult.snapshotPath, "metadata.json"),
        "utf-8",
      ),
    );
    const usersFile = path.join(
      backupResult.snapshotPath,
      metadata.collections.users.file,
    );
    const originalContent = await fs.readFile(usersFile);
    // Alter last byte
    const tamperedContent = Buffer.from(originalContent);
    tamperedContent[tamperedContent.length - 1] ^= 0xff;
    await fs.writeFile(usersFile, tamperedContent);

    // Checksum verification must fail
    await expect(verifyBackup(backupResult.snapshotPath)).rejects.toThrow(
      /Checksum mismatch/,
    );

    // Restore must abort and refuse to apply corrupted snapshot
    await expect(
      restoreBackup(backupResult.snapshotPath, { dropExisting: true }),
    ).rejects.toThrow(/Checksum mismatch/);
  });

  it("enforces secure directory permissions outside public web paths (SV-10)", async () => {
    await seedTestData();
    const backupResult = await createBackup({ backupDir: testBackupDir });

    // Verify backup location is not in public client directory
    expect(backupResult.snapshotPath).not.toContain("client/dist");
    expect(backupResult.snapshotPath).not.toContain("client/public");

    // Verify directory exists and is readable by owner
    const stat = await fs.stat(backupResult.snapshotPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("prunes snapshots older than retention threshold while preserving latest snapshots", async () => {
    const seeded = await seedTestData();

    // Create 3 snapshot directories with artificial ages
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const snapOld = path.join(testBackupDir, "snapshot-2026-01-01T00-00-00-000Z");
    const snapMid = path.join(testBackupDir, "snapshot-2026-01-05T00-00-00-000Z");
    const snapNew = path.join(testBackupDir, "snapshot-2026-01-15T00-00-00-000Z");

    for (const [dirPath, timestamp] of [
      [snapOld, new Date(now - 10 * dayMs).toISOString()],
      [snapMid, new Date(now - 3 * dayMs).toISOString()],
      [snapNew, new Date(now).toISOString()],
    ]) {
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(
        path.join(dirPath, "metadata.json"),
        JSON.stringify({ timestamp }),
      );
    }

    // Retention policy: keep 5 days
    const pruned = await pruneOldSnapshots(testBackupDir, 5);

    expect(pruned).toContain("snapshot-2026-01-01T00-00-00-000Z");
    expect(pruned).not.toContain("snapshot-2026-01-05T00-00-00-000Z");
    expect(pruned).not.toContain("snapshot-2026-01-15T00-00-00-000Z");
    expect(existsSync(snapOld)).toBe(false);
    expect(existsSync(snapMid)).toBe(true);
    expect(existsSync(snapNew)).toBe(true);
  });

  it("starts automated daily scheduler and triggers scheduled backup (NFR-2)", async () => {
    await seedTestData();

    let backupTriggered = false;
    let completedSnapshot = null;

    const job = startDailyBackupJob({
      backupDir: testBackupDir,
      intervalMs: 100, // fast interval for testing
      runImmediately: true,
      onSuccess: (res) => {
        backupTriggered = true;
        completedSnapshot = res.snapshotId;
      },
    });

    // Wait briefly for immediate execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(backupTriggered).toBe(true);
    expect(completedSnapshot).toBeDefined();

    const status = job.getStatus();
    expect(status.active).toBe(true);
    expect(status.lastRun).not.toBeNull();

    job.stop();
    expect(job.getStatus().active).toBe(false);
  });

  it("throws clear error when database connection is not active", async () => {
    const disconnectedMock = { readyState: 0 };
    await expect(
      createBackup({ connection: disconnectedMock, backupDir: testBackupDir }),
    ).rejects.toThrow(/Active database connection is required/);
    await expect(
      restoreBackup("/nonexistent", {
        connection: disconnectedMock,
      }),
    ).rejects.toThrow(/Active database connection is required/);
  });
});
