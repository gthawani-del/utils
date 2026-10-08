# QA status

- [x] Created in a standalone repository subfolder; root UtilityOS app files unchanged.
- [x] Includes demo screenplay, Remotion scene, input validator, export command, and validator regression tests.
- [ ] Run `npm install && npm run check` in GitHub Codespaces.
- [ ] Run `npm run render` and inspect actual MP4 frames and audio.
- [ ] Validate a real song's forced-alignment timestamps using a separate audio-processing stage.
- [ ] Add renderer job API for direct Plugin invocation once a trusted server is selected.

No rendered MP4 or sync correctness is claimed by this commit.
