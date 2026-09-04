import { createActionCompilationRetriever } from "./core";

export const retriever = createActionCompilationRetriever("lexical-topk", { maxCandidates: 32 });
export default retriever;
