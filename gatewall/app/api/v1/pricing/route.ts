import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  loadPersistedPricing,
  persistPrice,
  deletePersistedPrice,
  seedPersistedPricing,
} from "@/lib/storage/sqlite-driver";
import { ModelPricingItem } from "@/lib/types/pricing";

const priceSchema = z.object({
  provider: z.string().trim().min(1, "Le fournisseur est requis"),
  model: z.string().trim().min(1, "Le nom du modèle est requis"),
  promptUSDPerMillion: z.coerce.number().min(0, "Le prix prompt doit être supérieur ou égal à 0"),
  completionUSDPerMillion: z.coerce.number().min(0, "Le prix completion doit être supérieur ou égal à 0"),
  cacheHitUSDPerMillion: z.coerce.number().min(0).optional(),
  isActive: z.boolean().default(true),
});

export const GET = async (): Promise<NextResponse> => {
  let pricing = loadPersistedPricing();

  if (pricing.length === 0) {
    seedPersistedPricing(false);
    pricing = loadPersistedPricing();
  }

  const activeCount = pricing.filter((p) => p.isActive).length;

  return NextResponse.json({
    pricing,
    totalCount: pricing.length,
    activeCount,
  });
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "seed") {
      const seeded = seedPersistedPricing(true);
      const pricing = loadPersistedPricing();
      return NextResponse.json({ success: true, seeded, count: pricing.length });
    }

    const body = await request.json();

    if (body.action === "seed") {
      const seeded = seedPersistedPricing(Boolean(body.force));
      const pricing = loadPersistedPricing();
      return NextResponse.json({ success: true, seeded, count: pricing.length });
    }

    const validated = priceSchema.parse(body);

    const item: ModelPricingItem = {
      provider: validated.provider,
      model: validated.model,
      promptUSDPerMillion: validated.promptUSDPerMillion,
      completionUSDPerMillion: validated.completionUSDPerMillion,
      cacheHitUSDPerMillion: validated.cacheHitUSDPerMillion,
      isActive: validated.isActive,
      updatedAt: new Date().toISOString(),
    };

    persistPrice(item);

    return NextResponse.json({ success: true, item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation échouée", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Impossible d'enregistrer le tarif", details: String(error) },
      { status: 500 }
    );
  }
};

export const DELETE = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const model = url.searchParams.get("model");

    if (!provider || !model) {
      return NextResponse.json(
        { error: "Paramètres 'provider' et 'model' obligatoires" },
        { status: 400 }
      );
    }

    const success = deletePersistedPrice(provider, model);
    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json(
      { error: "Échec de suppression du tarif", details: String(error) },
      { status: 500 }
    );
  }
};
