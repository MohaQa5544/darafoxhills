import { getServer } from '../lib/runtime.mjs';
export default { fetch() { return getServer().health(); } };
