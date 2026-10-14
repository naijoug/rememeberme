import { setupServer } from 'msw/node';
const server = setupServer();
export const network = {
  enable: () => server.listen({ onUnhandledRequest: 'error' }),
  use: server.use.bind(server),
  resetHandlers: server.resetHandlers.bind(server),
  disable: () => server.close(),
};
