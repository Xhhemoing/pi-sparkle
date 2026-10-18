import {
  NativeWriteSession,
  type NativeWriteSessionInput,
  type NativeWriteSessionOptions,
  type NativeWriteSessionResult
} from "../native/write-session.js";
import { DomainValidationError } from "../domain/errors.js";
import { snapshotTaskPresentation, type TaskPresentationInput } from "../preferences/task-presentation.js";

/** Experimental host input; no queue, budget or automatic source application. */
export interface StartDevelopmentTaskInput extends NativeWriteSessionOptions, NativeWriteSessionInput {}

/**
 * Run one isolated development task using the existing native-write authority.
 * The host owns the verifier and executor. Candidates and evidence are retained
 * after session shutdown; successful verification does not apply source edits.
 * This deep module entry is experimental, not a stable package SDK export.
 */
export async function startDevelopmentTask(input: StartDevelopmentTaskInput): Promise<NativeWriteSessionResult> {
  // Validate before destructuring: a rest spread would invoke an accessor and
  // turn its return value into an ordinary data property before native preflight.
  const descriptor = Object.getOwnPropertyDescriptor(input, "presentation");
  if ((descriptor === undefined && "presentation" in input) || (descriptor !== undefined && !("value" in descriptor))) {
    throw new DomainValidationError("task presentation must be an own data property");
  }
  const presentation = snapshotTaskPresentation(descriptor?.value as TaskPresentationInput | undefined);
  const { stateRoot, executorFactory, sandboxRoot, presentation: _presentation, ...task } = input;
  const session = new NativeWriteSession({ stateRoot, executorFactory,
    ...(sandboxRoot === undefined ? {} : { sandboxRoot }) });
  try {
    return await session.execute({ ...task, ...(presentation === undefined ? {} : { presentation }) });
  } finally {
    await session.shutdown();
  }
}
