import { accountPath } from '../../account-gateway/index';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (accountPath(path) || path === '/api/v1/health') return env.ACCOUNT_GATEWAY.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
