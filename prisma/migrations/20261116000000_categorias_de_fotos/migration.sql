-- Categorías de la galería administrables: las cuatro de serie y las que cree Yury
CREATE TABLE "PhotoCategory" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhotoCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhotoCategory_label_key" ON "PhotoCategory"("label");

INSERT INTO "PhotoCategory" ("id", "label", "sortOrder") VALUES
    ('novias', 'Novias', 0),
    ('quinceaneras', 'Quinceañeras', 1),
    ('social', 'Social y noche', 2),
    ('temporada', 'Halloween y Catrinas', 3);
