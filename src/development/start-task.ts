import {
  NativeWriteSession,
  type NativeWriteSessionInput,
  type NativeWriteSessionOptions,
  type NativeWriteSessionResult
} from "../native/write-session.js";

/** Experimental host input; no queue, budget or automatic source application. */
export interface StartDevelopmentTaskInput extends NativeWriteSessionOptions, NativeWriteSessionInput {}

/**
 * Run one isolated development task using the existing native-write authority.
 * The host owns the verifier and executor. Candidates and evidence are retained
 * after session shutdown; successful verification does not apply source edits.
 * This deep module entry is experimental, not a stable package SDK export.
 */
export async function startDevelopmentTask(input: StartDevelopmentTaskInput): Promise<NativeWriteSessionResult> {
  const { stateRoot, executorFactory, sandboxRoot, ...task } = input;
  const session = new NativeWriteSession({ stateRoot, executorFactory,
    ...(sandboxRoot === undefined ? {} : { sandboxRoot }) });
  try {
    return await session.execute(task);
  } finally {
    await session.shutdown();
  }
}
