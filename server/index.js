import { createApp } from './app.js';
import { readPort } from './config.js';

const port = readPort();
const app = createApp();

app.listen(port, () => {
  console.log(`LLM Council listening on ${port}`);
});
