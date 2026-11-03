import { createFakePush } from './server';

const port = Number(process.env.PORT ?? 4020);
createFakePush((m) =>
  console.log(`push -> ${String(m.to)}: ${m.title ?? ''} ${m.body ?? ''}`),
).server.listen(port, () => console.log(`fake-push listening on :${port}`));
