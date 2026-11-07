import { createApp } from './app.js';
import { GraphStore } from './store.js';

let handler;

export default {
  fetch(request, env) {
    // Инстанцията се преизползва между заявките, за да се кешира токенът за Graph.
    handler ??= createApp({ env, store: new GraphStore(env) });
    return handler(request);
  },
};
