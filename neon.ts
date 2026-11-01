import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Auth (Managed Better Auth): player accounts for cloud saves.
  auth: true,
  functions: {
    // The cloud-save API the game calls with the player's login token.
    // Slug is permanent: lowercase letters/digits only.
    saves: {
      name: "hollowbrook cloud saves",
      source: "functions/saves/index.ts",
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
