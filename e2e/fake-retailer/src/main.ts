import { createFakeRetailer } from './server';

const port = Number(process.env.PORT ?? 4010);
createFakeRetailer().server.listen(port, () => {
  console.log(`fake-retailer listening on :${port}`);
});
