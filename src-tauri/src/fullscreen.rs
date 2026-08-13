use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
#[cfg(target_os = "macos")]
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{Emitter, State, Window, WindowEvent};

const FULLSCREEN_EVENT: &str = "revdown-fullscreen-changed";

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FullscreenAction {
    None,
    ExitNative,
    EnterImmersive,
}

#[derive(Default)]
pub struct FullscreenState {
    immersive: AtomicBool,
    converting_native: AtomicBool,
    enter_pending: AtomicBool,
}

impl FullscreenState {
    #[cfg(any(target_os = "macos", test))]
    fn action_for_resize(&self, native_fullscreen: bool) -> FullscreenAction {
        if native_fullscreen {
            if self.immersive.load(Ordering::SeqCst)
                || self.converting_native.swap(true, Ordering::SeqCst)
            {
                FullscreenAction::None
            } else {
                FullscreenAction::ExitNative
            }
        } else if self.converting_native.swap(false, Ordering::SeqCst) {
            self.enter_pending.store(true, Ordering::SeqCst);
            FullscreenAction::EnterImmersive
        } else {
            FullscreenAction::None
        }
    }

    fn set_immersive(&self, immersive: bool) {
        self.immersive.store(immersive, Ordering::SeqCst);
        if !immersive {
            self.converting_native.store(false, Ordering::SeqCst);
            self.enter_pending.store(false, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenError {
    code: &'static str,
    message: &'static str,
}

impl FullscreenError {
    fn native() -> Self {
        Self {
            code: "fullscreen_error",
            message: "The window could not change full-screen mode.",
        }
    }
}

fn report<R: tauri::Runtime>(window: &Window<R>, fullscreen: bool) {
    let _ = window.emit(FULLSCREEN_EVENT, fullscreen);
}

#[tauri::command]
pub fn set_window_fullscreen(
    window: Window,
    state: State<'_, Arc<FullscreenState>>,
    fullscreen: bool,
) -> Result<(), FullscreenError> {
    #[cfg(target_os = "macos")]
    {
        if fullscreen {
            if state.immersive.load(Ordering::SeqCst) {
                return Ok(());
            }
            if window
                .is_fullscreen()
                .map_err(|_| FullscreenError::native())?
            {
                state.converting_native.store(true, Ordering::SeqCst);
                window
                    .set_fullscreen(false)
                    .map_err(|_| FullscreenError::native())?;
                return Ok(());
            }
            window
                .set_simple_fullscreen(true)
                .map_err(|_| FullscreenError::native())?;
        } else {
            window
                .set_simple_fullscreen(false)
                .map_err(|_| FullscreenError::native())?;
            if window
                .is_fullscreen()
                .map_err(|_| FullscreenError::native())?
            {
                window
                    .set_fullscreen(false)
                    .map_err(|_| FullscreenError::native())?;
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    window
        .set_fullscreen(fullscreen)
        .map_err(|_| FullscreenError::native())?;

    state.set_immersive(fullscreen);
    report(&window, fullscreen);
    Ok(())
}

#[tauri::command]
pub fn window_fullscreen_state(
    window: Window,
    state: State<'_, Arc<FullscreenState>>,
) -> Result<bool, FullscreenError> {
    Ok(state.immersive.load(Ordering::SeqCst)
        || window
            .is_fullscreen()
            .map_err(|_| FullscreenError::native())?)
}

#[cfg(target_os = "macos")]
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Resized(_)) {
        let state = window.state::<Arc<FullscreenState>>();
        let Ok(native_fullscreen) = window.is_fullscreen() else {
            return;
        };
        match state.action_for_resize(native_fullscreen) {
            FullscreenAction::None => {}
            FullscreenAction::ExitNative => {
                let _ = window.set_fullscreen(false);
            }
            FullscreenAction::EnterImmersive => {
                let window = window.clone();
                let state = Arc::clone(state.inner());
                std::thread::spawn(move || {
                    // AppKit reports the final non-full-screen resize before it
                    // has completely left the native full-screen Space. Waiting
                    // for that transition prevents the simple-full-screen request
                    // from being ignored by tao's native-full-screen guard.
                    std::thread::sleep(Duration::from_millis(750));
                    if !state.enter_pending.swap(false, Ordering::SeqCst) {
                        return;
                    }
                    if window.is_fullscreen().unwrap_or(true) {
                        return;
                    }
                    if window.set_simple_fullscreen(true).is_ok() {
                        state.set_immersive(true);
                        report(&window, true);
                    }
                });
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn handle_window_event(_window: &Window, _event: &WindowEvent) {}

#[cfg(test)]
mod tests {
    use super::{FullscreenAction, FullscreenState};

    #[test]
    fn native_fullscreen_converts_after_its_exit_resize() {
        let state = FullscreenState::default();
        assert_eq!(state.action_for_resize(true), FullscreenAction::ExitNative);
        assert_eq!(state.action_for_resize(true), FullscreenAction::None);
        assert_eq!(
            state.action_for_resize(false),
            FullscreenAction::EnterImmersive
        );
        assert_eq!(state.action_for_resize(false), FullscreenAction::None);
    }

    #[test]
    fn immersive_windows_ignore_native_resize_conversion() {
        let state = FullscreenState::default();
        state.set_immersive(true);
        assert_eq!(state.action_for_resize(true), FullscreenAction::None);
    }
}
