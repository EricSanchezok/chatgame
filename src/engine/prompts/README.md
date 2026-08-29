# Living World prompt resources

Role contracts live in `system/`, call-specific task envelopes live in `user/`, shared semantic rules live in `shared/`, and provider transport text lives in `transport/`. The server loader in `index.ts` is the only code entry point; it normalizes, validates, caches, and content-hashes resources before a model request is sent.
