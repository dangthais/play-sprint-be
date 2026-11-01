import { createInMemoryAuthRepository } from './auth.repository.memory.ts';
import { describeAuthRepository } from './auth.repository.suite.ts';

describeAuthRepository('in-memory', async () => ({ repo: createInMemoryAuthRepository() }));
