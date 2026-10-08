CREATE TYPE "public"."ingredient_category" AS ENUM('produce', 'meat', 'dairy', 'dry_goods', 'spices', 'packaging', 'other');--> statement-breakpoint
CREATE TYPE "public"."waste_reason" AS ENUM('spoiled', 'overproduced', 'burnt', 'dropped', 'returned', 'other');--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" "ingredient_category" DEFAULT 'other' NOT NULL,
	"stock_unit" text NOT NULL,
	"purchase_unit" text NOT NULL,
	"stock_per_purchase_milli" integer DEFAULT 1000 NOT NULL,
	"last_cost_cents" integer DEFAULT 0 NOT NULL,
	"par_level_milli" integer DEFAULT 0 NOT NULL,
	"supplier" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"cost_cents_snapshot" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_lines_unique" UNIQUE("count_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"counted_on" date NOT NULL,
	"sales_since_last_cents" integer,
	"note" text,
	"counted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_date_unique" UNIQUE("counted_on")
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"stock_quantity_milli" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" text NOT NULL,
	"purchased_on" date NOT NULL,
	"reference" text,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waste_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"reason" "waste_reason" DEFAULT 'other' NOT NULL,
	"note" text,
	"wasted_on" date NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_counted_by_id_users_id_fk" FOREIGN KEY ("counted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredients_category_idx" ON "ingredients" USING btree ("category","sort_order");--> statement-breakpoint
CREATE INDEX "inventory_count_lines_ingredient_idx" ON "inventory_count_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "purchase_lines_purchase_idx" ON "purchase_lines" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_lines_ingredient_idx" ON "purchase_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("purchased_on");--> statement-breakpoint
CREATE INDEX "waste_entries_date_idx" ON "waste_entries" USING btree ("wasted_on");--> statement-breakpoint
CREATE INDEX "waste_entries_ingredient_idx" ON "waste_entries" USING btree ("ingredient_id");