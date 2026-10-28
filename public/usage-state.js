// Keep default-account pushes and late responses from replacing another
// conversation's quota. The host knows session ids; routing stays in plugins.
export function createUsageState({ load, render }) {
  let scope = null, choices = null, revision = 0;
  return {
    select(id, selectedChoices = null) {
      scope = id || null; choices = selectedChoices; revision++;
      render(null);
    },
    acceptDefault(snapshot) {
      if (scope !== null || choices !== null) return false;
      revision++; render(snapshot); return true;
    },
    async refresh(force = false) {
      const id = scope, request = ++revision;
      try {
        const snapshot = await load(id, force, choices);
        if (request !== revision || scope !== id) return false;
        render(snapshot); return true;
      } catch (error) {
        if (request !== revision || scope !== id) return false;
        render({ stale: true, unavailableReason: error.message });
        throw error;
      }
    },
  };
}
