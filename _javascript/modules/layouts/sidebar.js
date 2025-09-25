const ATTR_DISPLAY = 'sidebar-display';
const $sidebar = document.getElementById('sidebar');
const $trigger = document.getElementById('sidebar-trigger');
const $mask = document.getElementById('mask');

class SidebarUtil {
  static #isExpanded = false;

  static toggle() {
    this.#isExpanded = !this.#isExpanded;
    document.body.toggleAttribute(ATTR_DISPLAY, this.#isExpanded);
    $sidebar.classList.toggle('z-2', this.#isExpanded);
    $mask.classList.toggle('d-none', !this.#isExpanded);
  }
}

export function initSidebar() {
  // Defensive guards: elements may not exist in some pages/builds.
  if (!$trigger || !$mask || !$sidebar) {
    // Nothing to init — avoid throwing exceptions when DOM isn't present yet.
    console.warn('Sidebar elements not found, skipping initialization');
    return;
  }

  $trigger.onclick = $mask.onclick = () => SidebarUtil.toggle();
}
