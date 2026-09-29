// Shifts the wall clock forward so a test that only passes because "now" is
// close to the scripted world's start shows up. Use with:
//   SHIFT_DAYS=400 node --import ./tests/awake.mjs --import ./tests/helpers/shifted-clock.mjs --test tests/*.test.js
const days = Number(process.env.SHIFT_DAYS || 0);
if (days) {
  const shift = days * 86400000;
  const realNow = Date.now.bind(Date);
  const RealDate = Date;
  Date.now = () => realNow() + shift;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return args.length ? new target(...args) : new target(realNow() + shift);
    },
    apply(target) {
      return new target(realNow() + shift).toString();
    },
  });
}
