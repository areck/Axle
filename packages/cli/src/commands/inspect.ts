import { AxleClient } from "../client";
import { renderExecutionDetail } from "../ui";

export async function inspectCommand(
  executionId: string,
  options: { api: string; json: boolean },
): Promise<void> {
  const client = new AxleClient(options.api);
  const execution = await client.getExecution(executionId);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(execution, null, 2)}\n`);
  } else {
    renderExecutionDetail(execution);
  }
}
