use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{Emitter, State, Window, WindowEvent};

const FULLSCREEN_EVENT: &str = "revdown-fullscreen-changed";

#[derive(Default)]
pub struct FullscreenState {
    immersive: AtomicBool,
    native: AtomicBool,
}

impl FullscreenState {
    fn set(&self, immersive: bool, native: bool) {
        self.immersive.store(immersive, Ordering::SeqCst);
        self.native.store(native, Ordering::SeqCst);
    }

    fn current(&self) -> bool {
        self.immersive.load(Ordering::SeqCst) || self.native.load(Ordering::SeqCst)
    }

    fn record_native_transition(&self, native: bool) -> Option<bool> {
        if self.immersive.load(Ordering::SeqCst) {
            return None;
        }
        let previous = self.native.swap(native, Ordering::SeqCst);
        (previous != native).then_some(native)
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
    let native = window
        .is_fullscreen()
        .map_err(|_| FullscreenError::native())?;

    #[cfg(target_os = "macos")]
    {
        if fullscreen {
            if state.current() || native {
                if native {
                    state.set(false, true);
                }
                report(&window, true);
                return Ok(());
            }
            window
                .set_simple_fullscreen(true)
                .map_err(|_| FullscreenError::native())?;
            state.set(true, false);
        } else {
            if state.immersive.load(Ordering::SeqCst) {
                window
                    .set_simple_fullscreen(false)
                    .map_err(|_| FullscreenError::native())?;
            }
            if native {
                window
                    .set_fullscreen(false)
                    .map_err(|_| FullscreenError::native())?;
            }
            state.set(false, false);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_fullscreen(fullscreen)
            .map_err(|_| FullscreenError::native())?;
        state.set(fullscreen, false);
    }

    report(&window, fullscreen);
    Ok(())
}

#[tauri::command]
pub fn window_fullscreen_state(
    window: Window,
    state: State<'_, Arc<FullscreenState>>,
) -> Result<bool, FullscreenError> {
    let native = window
        .is_fullscreen()
        .map_err(|_| FullscreenError::native())?;
    if !state.immersive.load(Ordering::SeqCst) {
        state.native.store(native, Ordering::SeqCst);
    }
    Ok(state.current() || native)
}

#[cfg(target_os = "macos")]
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Resized(_)) {
        let state = window.state::<Arc<FullscreenState>>();
        let Ok(native) = window.is_fullscreen() else {
            return;
        };
        if let Some(fullscreen) = state.record_native_transition(native) {
            report(window, fullscreen);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn handle_window_event(_window: &Window, _event: &WindowEvent) {}

#[cfg(test)]
mod tests {
    use super::FullscreenState;

    #[test]
    fn native_fullscreen_transitions_are_reported_once() {
        let state = FullscreenState::default();
        assert_eq!(state.record_native_transition(false), None);
        assert_eq!(state.record_native_transition(true), Some(true));
        assert_eq!(state.record_native_transition(true), None);
        assert_eq!(state.record_native_transition(false), Some(false));
    }

    #[test]
    fn native_resize_events_do_not_override_immersive_state() {
        let state = FullscreenState::default();
        state.set(true, false);
        assert_eq!(state.record_native_transition(true), None);
        assert!(state.current());
    }
}
