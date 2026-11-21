/** 键鼠输入 + Pointer Lock 管理。 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** 测试/自动驾驶时可以关闭对真实 Pointer Lock 的依赖 */
  virtualLock = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onLockError: (() => void) | null = null;
  private lastUnlock = 0;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // 游戏内屏蔽浏览器默认行为（空格滚动、Ctrl+S 等）
      if (this.isLocked() && (e.code === 'Space' || e.code === 'Tab' || e.ctrlKey)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked()) return;
      const code = 'Mouse' + e.button;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = 'Mouse' + e.button;
      this.down.delete(code);
      this.released.add(code);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // 过滤个别浏览器在锁定瞬间产生的异常大位移
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.isLocked()) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.lastUnlock = performance.now();
        this.clearAll();
      }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.onLockError?.();
    });
    window.addEventListener('blur', () => this.clearAll());
  }

  isLocked(): boolean {
    return this.locked || this.virtualLock;
  }

  /** 浏览器在 Esc 解锁后约 1 秒内不允许再次锁定，这里返回是否可以安全请求。 */
  canRelock(): boolean {
    return performance.now() - this.lastUnlock > 1100;
  }

  requestLock(): void {
    if (this.virtualLock) {
      this.onLockChange?.(true);
      return;
    }
    if (document.pointerLockElement === this.el) return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => this.onLockError?.());
    } catch {
      this.onLockError?.();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** 测试钩子：模拟按键 */
  simulate(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  clearAll(): void {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
