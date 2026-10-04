let saved: Record<string,string> = {};
try {
  saved = JSON.parse(await Deno.readTextFile('/home/deno/functions/_shared/stripe-secrets.json'));
} catch (_) {
  // Optional fallback for this self-hosted installation.
}

export const secret = (name:string) => Deno.env.get(name) || saved[name];
