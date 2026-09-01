import { defineConfig } from 'vitest/config';

// Pin a DST-observing timezone. The quota and the chart are calendar-local
// ("Monday 00:00", "one day per column"), and the invariant that would break
// under naive `+ 86_400_000` maths only exists where clocks actually shift —
// in UTC the bug is invisible and the guard tests would pass either way.
process.env.TZ = process.env.TZ || 'Europe/Berlin';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
