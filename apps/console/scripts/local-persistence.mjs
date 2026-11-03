import {resolve} from 'node:path';

// Miniflare 5 的统一资源根目录；旧版 d1Persist/r2Persist 会被转换器忽略。
export function localPersistence(root,enabled){return enabled?{resourcePersistencePath:resolve(root,'resources')}:{};}
