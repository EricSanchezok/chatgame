import { createActionCompilationRetriever } from "./core";

export const retriever = createActionCompilationRetriever("adaptive-hybrid", { maxCandidates: 32 });
export default retriever;
