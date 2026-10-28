import { getServer } from '../lib/runtime.mjs';
export default { fetch(request) { return getServer().rpc(request); } };
