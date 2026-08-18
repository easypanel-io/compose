// @ts-nocheck Deno edge function, not resolvable by Node/TS tooling
// eslint-disable-next-line import/no-unresolved
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// eslint-disable-next-line import/no-unresolved
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  try {
    // Create a Supabase client with service role key for admin operations
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get all stores
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id, name");

    if (storesError) {
      throw storesError;
    }

    if (!stores || stores.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No stores found to create folders for",
          foldersCreated: [],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const results = [];

    // Create a folder for each store by uploading a placeholder file
    for (const store of stores) {
      const folderPath = `${store.id}/.keep`;

      // Check if folder already exists
      const { data: existing } = await supabase.storage
        .from("circulars")
        .list(store.id);

      // Only create if folder doesn't exist
      if (!existing || existing.length === 0) {
        // Create empty placeholder file to establish the folder structure
        const emptyContent = new Blob([""], { type: "text/plain" });

        const { error: uploadError } = await supabase.storage
          .from("circulars")
          .upload(folderPath, emptyContent, {
            contentType: "text/plain",
            upsert: true,
          });

        if (uploadError) {
          console.error(
            `Error creating folder for store ${store.name}:`,
            uploadError,
          );
          results.push({
            storeId: store.id,
            storeName: store.name,
            success: false,
            error: uploadError.message,
          });
        } else {
          console.log(
            `✓ Folder created for store: ${store.name} (${store.id})`,
          );
          results.push({
            storeId: store.id,
            storeName: store.name,
            success: true,
          });
        }
      } else {
        console.log(`✓ Folder already exists for store: ${store.name}`);
        results.push({
          storeId: store.id,
          storeName: store.name,
          success: true,
          alreadyExists: true,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Initialized folders for ${successCount} stores`,
        foldersCreated: results,
        totalStores: stores.length,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: any) {
    console.error("Error creating store folders:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Unknown error",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
