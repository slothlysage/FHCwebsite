ALTER TABLE "order_items" ADD COLUMN "oversold_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "allow_backorder" boolean DEFAULT true NOT NULL;