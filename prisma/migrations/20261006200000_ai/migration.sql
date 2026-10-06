-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('EXTRACT', 'SUMMARISE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "errorCode" TEXT,
    "error" TEXT,
    "rawOutput" TEXT,
    "result" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_userId_createdAt_idx" ON "Document"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_createdAt_idx" ON "Job"("status", "runAfter", "createdAt");

-- CreateIndex
CREATE INDEX "Job_documentId_kind_createdAt_idx" ON "Job"("documentId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written from here: Prisma's schema language cannot express these.

-- A stored file always has content.
ALTER TABLE "Document" ADD CONSTRAINT "Document_size_check" CHECK ("sizeBytes" > 0);

ALTER TABLE "Job" ADD CONSTRAINT "Job_attempts_check" CHECK ("attempts" >= 0);

-- A job's status and its columns cannot disagree:
--   DONE   has a validated result and a finish time
--   FAILED has an error message and a finish time, and no result
--   PENDING / PROCESSING have neither a result nor a finish time
ALTER TABLE "Job" ADD CONSTRAINT "Job_status_shape_check" CHECK (
  ("status" = 'DONE' AND "result" IS NOT NULL AND "finishedAt" IS NOT NULL)
  OR ("status" = 'FAILED' AND "result" IS NULL AND "error" IS NOT NULL AND "finishedAt" IS NOT NULL)
  OR ("status" IN ('PENDING', 'PROCESSING') AND "result" IS NULL AND "finishedAt" IS NULL)
);

-- At most one unfinished job of each kind per document. A double click on
-- "Summarise" or "Try again" cannot queue the same paid work twice.
CREATE UNIQUE INDEX "Job_one_active_per_document_kind_key" ON "Job"("documentId", "kind") WHERE "status" IN ('PENDING', 'PROCESSING');
