use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static HUB_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

pub fn is_hub_online() -> bool {
    let addr: SocketAddr = match "127.0.0.1:6200".parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

pub fn try_spawn_hub_service() {
    if is_hub_online() {
        return;
    }

    // 寻找工作目录候选
    let mut candidate_dirs = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            candidate_dirs.push(parent.to_path_buf());
            if let Some(grand) = parent.parent() {
                candidate_dirs.push(grand.to_path_buf());
            }
        }
    }
    candidate_dirs.push(std::path::PathBuf::from(r"C:\Users\Administrator\FEAGLEwxbot\apps\hub"));

    let mut working_dir = None;
    for dir in candidate_dirs {
        let entry = dir.join("src").join("index.js");
        if entry.exists() {
            working_dir = Some(dir);
            break;
        }
    }

    let Some(work_dir) = working_dir else {
        return;
    };

    let mut cmd = Command::new("node.exe");
    cmd.arg("src/index.js").current_dir(&work_dir);

    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    if let Ok(child) = cmd.spawn() {
        if let Ok(mut lock) = HUB_PROCESS.lock() {
            *lock = Some(child);
        }

        // 最多等待 4 秒等待端口就绪
        for _ in 1..=20 {
            std::thread::sleep(Duration::from_millis(200));
            if is_hub_online() {
                break;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 在窗口完全展示前自动自愈拉起本地 Hub 后端服务
            try_spawn_hub_service();

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // 退出桌面应用时安全销毁自身拉起的后台进程
                if let Ok(mut lock) = HUB_PROCESS.lock() {
                    if let Some(mut child) = lock.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
