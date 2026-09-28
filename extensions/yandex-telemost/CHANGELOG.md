## [Fix create-meeting on redesigned Telemost page] - {PR_MERGE_DATE}

### Fixed
- New Meeting commands no longer get stuck on the updated Telemost start page: the create button is picked more reliably, broadcast / schedule / join buttons are ignored, and a "Создать → Видеовстреча" dropdown is handled
- Timeout toast now shows which button was clicked or which buttons were found

## [1.0.0] - 2026-06-05

### Added
- New Meeting command — creates a Yandex Telemost meeting and copies the link to clipboard
- New Meeting and Refocus command — creates a meeting, copies the link, and returns focus to the previous app
- Join Meeting command — join a meeting by link or code
- Preferred Browser preference to override the default browser
