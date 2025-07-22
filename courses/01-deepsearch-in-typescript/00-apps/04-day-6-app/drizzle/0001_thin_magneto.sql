CREATE TABLE IF NOT EXISTS "ai-app-template_system_context" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"chat_id" varchar(255) NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"query_history" json DEFAULT '[]'::json NOT NULL,
	"scrape_history" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DROP TABLE "ai-app-template_request";--> statement-breakpoint
DROP INDEX IF EXISTS "chat_user_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "message_chat_id_idx";--> statement-breakpoint
ALTER TABLE "ai-app-template_chat" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-app-template_message" ALTER COLUMN "order" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "ai-app-template_message" ALTER COLUMN "parts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-app-template_message" ALTER COLUMN "role" SET DATA TYPE varchar(255);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai-app-template_system_context" ADD CONSTRAINT "ai-app-template_system_context_chat_id_ai-app-template_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai-app-template_chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "ai-app-template_message" DROP COLUMN IF EXISTS "content";