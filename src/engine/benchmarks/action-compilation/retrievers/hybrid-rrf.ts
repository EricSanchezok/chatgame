import { createActionCompilationRetriever } from "./core";

export const retriever = createActionCompilationRetriever("hybrid-rrf", { maxCandidates: 32 });
export default retriever;
