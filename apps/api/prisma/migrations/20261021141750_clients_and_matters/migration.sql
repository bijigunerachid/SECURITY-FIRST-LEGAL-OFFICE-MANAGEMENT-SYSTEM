-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('person', 'company');

-- CreateEnum
CREATE TYPE "MatterArea" AS ENUM ('civil', 'commercial', 'criminal', 'family', 'administrative', 'labour', 'real_estate', 'other');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('open', 'on_hold', 'closed');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('lead', 'member');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('opposing_party', 'opposing_counsel', 'co_party', 'witness', 'expert', 'other');

-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "kind" "ClientKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "search_name" VARCHAR(200) NOT NULL,
    "identifier" VARCHAR(64),
    "search_identifier" VARCHAR(64),
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "address" VARCHAR(500),
    "notes" VARCHAR(4000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_counter" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "matter_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "matter" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(16) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "area" "MatterArea" NOT NULL,
    "status" "MatterStatus" NOT NULL DEFAULT 'open',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "court" VARCHAR(200),
    "court_case_number" VARCHAR(64),
    "description" VARCHAR(4000),
    "opened_on" DATE NOT NULL,
    "closed_on" DATE,
    "client_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_member" (
    "matter_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_member_pkey" PRIMARY KEY ("matter_id","user_id")
);

-- CreateTable
CREATE TABLE "party" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "kind" "ClientKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "search_name" VARCHAR(200) NOT NULL,
    "role" "PartyRole" NOT NULL,
    "identifier" VARCHAR(64),
    "search_identifier" VARCHAR(64),
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grant" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "break_glass_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_search_name_idx" ON "client"("search_name");

-- CreateIndex
CREATE INDEX "client_search_identifier_idx" ON "client"("search_identifier");

-- CreateIndex
CREATE INDEX "client_created_by_id_idx" ON "client"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "matter_reference_key" ON "matter"("reference");

-- CreateIndex
CREATE INDEX "matter_client_id_idx" ON "matter"("client_id");

-- CreateIndex
CREATE INDEX "matter_status_idx" ON "matter"("status");

-- CreateIndex
CREATE INDEX "matter_member_user_id_idx" ON "matter_member"("user_id");

-- CreateIndex
CREATE INDEX "party_matter_id_idx" ON "party"("matter_id");

-- CreateIndex
CREATE INDEX "party_search_name_idx" ON "party"("search_name");

-- CreateIndex
CREATE INDEX "party_search_identifier_idx" ON "party"("search_identifier");

-- CreateIndex
CREATE INDEX "break_glass_grant_user_id_expires_at_idx" ON "break_glass_grant"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "break_glass_grant_matter_id_idx" ON "break_glass_grant"("matter_id");

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter" ADD CONSTRAINT "matter_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter" ADD CONSTRAINT "matter_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_member" ADD CONSTRAINT "matter_member_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_member" ADD CONSTRAINT "matter_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party" ADD CONSTRAINT "party_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
