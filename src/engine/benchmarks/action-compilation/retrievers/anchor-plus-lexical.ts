import { createActionCompilationRetriever } from "./core";

export const retriever = createActionCompilationRetriever("anchor-plus-lexical", { maxCandidates: 32 });
export default retriever;
