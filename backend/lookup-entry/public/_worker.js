// The fixed Pages hostname delegates in-process to the validated lookup gateway.
// This layer has no origin URLs, provider credentials or account data.
export default {
  async fetch(request, env) {
    return env.LOOKUP_GATEWAY.fetch(request);
  },
};
