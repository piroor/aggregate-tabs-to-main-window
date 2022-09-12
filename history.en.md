# History

 - master/HEAD
 - 1.6 (2022.9.12)
   * Add ability to mark a specific window as "Main Window" permanently with the toolbar button.
   * Separate option to control behavior for tabs maybe opened from external applications.
 - 1.5 (2022.3.28)
   * Aggregate new tabs more certainly. New tabs opened with URL were wrongly detected as blank tabs on recent versions of Firefox.
   * Don't aggregate background tabs loaded in a thin window (detected as a sidebar window).
   * Don't aggregate tabs in dialog windows.
   * Fix unhandled error around already closed source windows.
   * Fix wrong behaviors of "All Configs" UI: apply imported configs to options UI immediately and treat decimal values as valid for some numeric options.
 - 1.4 (2020.7.29)
   * Detect URL of tabs opened from external applications more correctly.
   * Detect tabs opened from bookmarks more correctly.
   * Drop support for versions of Firefox older than 68.
 - 1.3.3 (2019.5.13)
   * Ignore difference of windowsize smaller than 5 pixels.
   * Detect the main window based on their size at first, isntead of the number of tabs. (Revert the cange on the previous version.)
 - 1.3.2 (2019.5.4)
   * Detect the main window based on the number of tabs at first.
   * Don't aggregate tabs opened as the initial tab of a new window.
   * Add ability to export and import all configurations except keyboard shortcuts. (Options => "Development" => "Debug mode" => "All Configs" => "Import/Export")
 - 1.3.1 (2019.2.19)
   * Don't aggregate duplicated and restored tabs by default.
 - 1.3.0 (2018.9.10)
   * Add ability to configure conditions of tabs to be moved.
 - 1.2.1 (2018.5.31)
   * Don't move tabs between regular window and private browsing window.
 - 1.2 (2018.5.25)
   * Add "Sidebar Only Window" mode. When this mode is activated, URLs loaded into the current tab in small windows are opened as tabs in the main window.
 - 1.1 (2018.5.24)
   * Make conditions to find main window configurable.
   * Better support of session restoration.
 - 1.0 (2018.5.24)
   * Initial release.
