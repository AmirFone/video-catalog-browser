use eframe::egui;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use crossbeam_channel::Receiver;

use crate::db::Database;
use crate::scanner::{ScanProgress, ScanResult};
use crate::cache::TextureCache;
use crate::video::{HoverDecoder, VideoPlayer};
use crate::settings::AppSettings;

/// Main application state
pub struct VideoCatalogApp {
    /// Current scanned directory path
    current_path: Option<PathBuf>,

    /// List of videos from database
    videos: Vec<Video>,

    /// Current sort option
    sort_option: SortOption,

    /// View mode (all videos or favorites)
    view_mode: ViewMode,

    /// Currently hovered video ID
    hover_video_id: Option<String>,

    /// Hover position (0.0 to 1.0)
    hover_position: f32,

    /// Current scroll offset
    _scroll_offset: f32,

    /// Database connection
    _db: Option<Database>,

    /// Scan progress (shared with background thread)
    scan_progress: Arc<Mutex<Option<ScanProgress>>>,

    /// Channel to receive scan results
    scan_result_rx: Option<Receiver<ScanResult>>,

    /// Texture cache for thumbnails
    texture_cache: TextureCache,

    /// App state
    state: AppState,

    /// Path input text
    path_input: String,

    // --- Hover scrubbing state ---
    /// Background hover decoder (never blocks UI thread)
    hover_decoder: HoverDecoder,

    /// Cached hover frame texture
    hover_frame_texture: Option<egui::TextureHandle>,

    /// Last requested hover position (to avoid duplicate requests)
    last_hover_position: f32,

    /// Currently hovered video path (to detect changes)
    hover_video_path: Option<PathBuf>,

    // --- Video player modal state ---
    /// Video player for modal playback
    video_player: Option<VideoPlayer>,

    /// Player frame texture
    player_texture: Option<egui::TextureHandle>,

    /// Whether video modal is visible
    show_video_modal: bool,

    /// Currently selected video for modal
    selected_video: Option<Video>,

    // --- UI state ---
    /// Whether to show clear cache confirmation dialog
    show_clear_cache_confirm: bool,

    // --- App-level settings ---
    /// Persistent app settings (library history, preferences)
    app_settings: Option<AppSettings>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AppState {
    /// No directory selected
    SelectDirectory,
    /// Scanning in progress
    Scanning,
    /// Displaying video grid
    Browsing,
    /// Error state
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SortOption {
    DateNewest,
    DateOldest,
    DurationLongest,
    DurationShortest,
    NameAZ,
    NameZA,
}

impl Default for SortOption {
    fn default() -> Self {
        SortOption::DateNewest
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ViewMode {
    AllVideos,
    Favorites,
}

impl Default for ViewMode {
    fn default() -> Self {
        ViewMode::AllVideos
    }
}

/// Video metadata
#[derive(Debug, Clone)]
pub struct Video {
    pub id: String,
    pub file_path: PathBuf,
    pub file_name: String,
    pub file_size: u64,
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub _has_thumbnail: bool,
    pub has_sprite: bool,
    pub thumbnail_path: Option<PathBuf>,
    pub sprite_path: Option<PathBuf>,
    pub is_favorite: bool,
}

impl VideoCatalogApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        // Try to load app settings
        let app_settings = AppSettings::open().ok();

        // Load saved preferences
        let sort_option = app_settings.as_ref()
            .and_then(|s| s.get_sort_option())
            .and_then(|v| match v.as_str() {
                "DateNewest" => Some(SortOption::DateNewest),
                "DateOldest" => Some(SortOption::DateOldest),
                "DurationLongest" => Some(SortOption::DurationLongest),
                "DurationShortest" => Some(SortOption::DurationShortest),
                "NameAZ" => Some(SortOption::NameAZ),
                "NameZA" => Some(SortOption::NameZA),
                _ => None,
            })
            .unwrap_or_default();

        let view_mode = app_settings.as_ref()
            .and_then(|s| s.get_view_mode())
            .and_then(|v| match v.as_str() {
                "AllVideos" => Some(ViewMode::AllVideos),
                "Favorites" => Some(ViewMode::Favorites),
                _ => None,
            })
            .unwrap_or_default();

        Self {
            current_path: None,
            videos: Vec::new(),
            sort_option,
            view_mode,
            hover_video_id: None,
            hover_position: 0.0,
            _scroll_offset: 0.0,
            _db: None,
            scan_progress: Arc::new(Mutex::new(None)),
            scan_result_rx: None,
            texture_cache: TextureCache::new(500), // Max 500 textures cached
            state: AppState::SelectDirectory,
            path_input: String::new(),
            // Hover scrubbing state (background decoder - never blocks UI)
            hover_decoder: HoverDecoder::new(),
            hover_frame_texture: None,
            last_hover_position: -1.0,
            hover_video_path: None,
            // Video player modal state
            video_player: None,
            player_texture: None,
            show_video_modal: false,
            selected_video: None,
            // UI state
            show_clear_cache_confirm: false,
            // App-level settings
            app_settings,
        }
    }

    /// Start scanning a directory
    fn start_scan(&mut self, path: PathBuf) {
        self.current_path = Some(path.clone());
        self.state = AppState::Scanning;

        // Create progress tracker
        let progress = Arc::clone(&self.scan_progress);
        *progress.lock().unwrap() = Some(ScanProgress::default());

        // Create channel for results
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.scan_result_rx = Some(rx);

        // Spawn background scan thread
        let progress_clone = Arc::clone(&self.scan_progress);
        std::thread::spawn(move || {
            let result = crate::scanner::scan_directory(&path, progress_clone);
            let _ = tx.send(result);
        });
    }

    /// Check for scan completion
    fn check_scan_completion(&mut self) {
        if let Some(rx) = &self.scan_result_rx {
            if let Ok(result) = rx.try_recv() {
                match result {
                    Ok(videos) => {
                        self.videos = videos.clone();
                        self.state = AppState::Browsing;

                        // Update library history
                        if let (Some(ref settings), Some(ref path)) = (&self.app_settings, &self.current_path) {
                            let name = path.file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| path.display().to_string());

                            // Get first video's thumbnail as library thumbnail
                            let thumbnail = videos.first()
                                .and_then(|v| v.thumbnail_path.as_ref());

                            let _ = settings.update_library(
                                path,
                                &name,
                                videos.len() as i64,
                                thumbnail,
                            );
                        }
                    }
                    Err(e) => {
                        self.state = AppState::Error(e.to_string());
                    }
                }
                self.scan_result_rx = None;
            }
        }
    }
}

impl eframe::App for VideoCatalogApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Check for scan completion
        self.check_scan_completion();

        // Request repaint during scanning for progress updates
        if self.state == AppState::Scanning {
            ctx.request_repaint();
        }

        // Request repaint during video playback
        if self.video_player.as_ref().map(|p| p.is_playing()).unwrap_or(false) {
            ctx.request_repaint();
        }

        // Request repaint while hovering (throttled to ~30 FPS to save CPU)
        if self.hover_video_id.is_some() {
            ctx.request_repaint_after(std::time::Duration::from_millis(33));
        }

        // Top panel with header - clean styling
        egui::TopBottomPanel::top("header")
            .frame(egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 22, 26))
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(35, 40, 48)))
            )
            .show(ctx, |ui| {
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("Video Catalog Browser").size(16.0).strong());
                ui.add_space(8.0);
                ui.label(egui::RichText::new("Quick preview of your video catalog").color(egui::Color32::from_rgb(100, 105, 115)));

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if self.state == AppState::Browsing {
                        // View mode toggle
                        let all_selected = self.view_mode == ViewMode::AllVideos;
                        if ui.selectable_label(all_selected, "All Videos").clicked() {
                            self.view_mode = ViewMode::AllVideos;
                            if let Some(ref settings) = self.app_settings {
                                let _ = settings.set_view_mode("AllVideos");
                            }
                        }
                        if ui.selectable_label(!all_selected, "Favorites").clicked() {
                            self.view_mode = ViewMode::Favorites;
                            if let Some(ref settings) = self.app_settings {
                                let _ = settings.set_view_mode("Favorites");
                            }
                        }
                    }
                });
            });
            ui.add_space(8.0);
        });

        // Main content
        egui::CentralPanel::default().show(ctx, |ui| {
            match &self.state {
                AppState::SelectDirectory => {
                    self.show_directory_picker(ui);
                }
                AppState::Scanning => {
                    self.show_scan_progress(ui);
                }
                AppState::Browsing => {
                    self.show_video_grid(ui, ctx);
                }
                AppState::Error(msg) => {
                    self.show_error(ui, msg.clone());
                }
            }
        });

        // Show clear cache confirmation dialog with glass styling
        if self.show_clear_cache_confirm {
            egui::Window::new("")
                .title_bar(false)
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .frame(egui::Frame::none()
                    .fill(egui::Color32::from_rgba_unmultiplied(35, 30, 28, 250))
                    .rounding(16.0)
                    .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(255, 255, 255, 15)))
                    .shadow(egui::Shadow {
                        offset: egui::vec2(0.0, 8.0),
                        blur: 24.0,
                        spread: 0.0,
                        color: egui::Color32::from_rgba_unmultiplied(0, 0, 0, 120),
                    })
                    .inner_margin(egui::Margin::same(24.0))
                )
                .show(ctx, |ui| {
                    ui.label(egui::RichText::new("⚠️ Clear Cache").size(18.0).strong().color(egui::Color32::WHITE));
                    ui.add_space(15.0);
                    ui.label(egui::RichText::new("This will delete all cached thumbnails and database for this library.")
                        .color(egui::Color32::from_rgb(200, 190, 180)));
                    ui.label(egui::RichText::new("You will need to re-scan to view videos.")
                        .color(egui::Color32::from_rgb(160, 150, 140)));
                    ui.add_space(20.0);
                    ui.horizontal(|ui| {
                        if ui.button("Cancel").clicked() {
                            self.show_clear_cache_confirm = false;
                        }
                        ui.add_space(15.0);
                        if ui.button(egui::RichText::new("Clear Cache").color(egui::Color32::from_rgb(230, 100, 100))).clicked() {
                            if let Some(path) = &self.current_path {
                                let vcb_data = path.join(".vcb-data");
                                let _ = std::fs::remove_dir_all(&vcb_data);
                            }
                            self.videos.clear();
                            self.current_path = None;
                            self.state = AppState::SelectDirectory;
                            self.show_clear_cache_confirm = false;
                        }
                    });
                });
        }

        // Show video modal on top if visible
        self.render_video_modal(ctx);

        // Update player frame texture
        self.update_player_frame(ctx);
    }
}

impl VideoCatalogApp {
    fn show_directory_picker(&mut self, ui: &mut egui::Ui) {
        // Check for library to open (from recent libraries click)
        let mut library_to_open: Option<PathBuf> = None;
        let mut library_to_remove: Option<i64> = None;

        ui.vertical_centered(|ui| {
            ui.add_space(50.0);

            // Clean folder icon
            ui.label(egui::RichText::new("📁").size(48.0));

            ui.add_space(16.0);
            ui.label(egui::RichText::new("Video Catalog Browser").size(24.0).strong());
            ui.add_space(6.0);
            ui.label(egui::RichText::new("Select a folder to scan or open a recent library").color(egui::Color32::from_rgb(130, 138, 150)));

            ui.add_space(30.0);

            // Recent Libraries section
            if let Some(ref settings) = self.app_settings {
                if let Ok(libraries) = settings.get_library_history() {
                    if !libraries.is_empty() {
                        ui.label(egui::RichText::new("Recent Libraries").size(16.0).color(egui::Color32::from_rgb(130, 138, 150)));
                        ui.add_space(16.0);

                        // Grid of library cards - clean minimal design
                        let card_width = 180.0;
                        let card_height = 120.0;
                        let spacing = 12.0;

                        ui.horizontal_wrapped(|ui| {
                            ui.spacing_mut().item_spacing = egui::vec2(spacing, spacing);

                            for library in &libraries {
                                let (rect, response) = ui.allocate_exact_size(
                                    egui::vec2(card_width, card_height),
                                    egui::Sense::click(),
                                );

                                if ui.is_rect_visible(rect) {
                                    let painter = ui.painter();

                                    // Clean card background
                                    let bg_color = if response.hovered() {
                                        egui::Color32::from_rgb(32, 36, 44)
                                    } else {
                                        egui::Color32::from_rgb(24, 27, 33)
                                    };
                                    let border_color = if response.hovered() {
                                        egui::Color32::from_rgb(99, 140, 255)
                                    } else {
                                        egui::Color32::from_rgb(45, 50, 60)
                                    };

                                    painter.rect_filled(rect, 8.0, bg_color);
                                    painter.rect_stroke(rect, 8.0, egui::Stroke::new(1.0, border_color));

                                    // Simple icon
                                    painter.text(
                                        egui::pos2(rect.left() + 14.0, rect.top() + 16.0),
                                        egui::Align2::LEFT_TOP,
                                        "🎬",
                                        egui::FontId::proportional(24.0),
                                        egui::Color32::from_rgb(99, 140, 255),
                                    );

                                    // Library name
                                    let name_pos = egui::pos2(rect.left() + 14.0, rect.top() + 52.0);
                                    let name_galley = painter.layout(
                                        library.name.clone(),
                                        egui::FontId::proportional(13.0),
                                        egui::Color32::from_rgb(240, 242, 245),
                                        card_width - 28.0,
                                    );
                                    painter.galley(name_pos, name_galley, egui::Color32::from_rgb(240, 242, 245));

                                    // Video count
                                    let count_text = format!("{} videos", library.video_count);
                                    painter.text(
                                        egui::pos2(rect.left() + 14.0, rect.top() + 75.0),
                                        egui::Align2::LEFT_TOP,
                                        count_text,
                                        egui::FontId::proportional(11.0),
                                        egui::Color32::from_rgb(130, 138, 150),
                                    );

                                    // Last opened
                                    let last_opened = chrono::DateTime::parse_from_rfc3339(&library.last_opened)
                                        .map(|dt| dt.format("%m/%d/%Y").to_string())
                                        .unwrap_or_else(|_| "Unknown".to_string());
                                    painter.text(
                                        egui::pos2(rect.left() + 14.0, rect.top() + 92.0),
                                        egui::Align2::LEFT_TOP,
                                        last_opened,
                                        egui::FontId::proportional(10.0),
                                        egui::Color32::from_rgb(100, 105, 115),
                                    );

                                    // Remove button (X) - only on hover
                                    let x_size = 20.0;
                                    let x_rect = egui::Rect::from_min_size(
                                        egui::pos2(rect.right() - x_size - 8.0, rect.top() + 8.0),
                                        egui::vec2(x_size, x_size),
                                    );

                                    if response.hovered() {
                                        painter.rect_filled(x_rect, 4.0, egui::Color32::from_rgb(180, 60, 60));
                                        painter.text(
                                            x_rect.center(),
                                            egui::Align2::CENTER_CENTER,
                                            "×",
                                            egui::FontId::proportional(12.0),
                                            egui::Color32::WHITE,
                                        );

                                        if response.clicked() {
                                            if let Some(pointer_pos) = ui.ctx().pointer_interact_pos() {
                                                if x_rect.contains(pointer_pos) {
                                                    library_to_remove = Some(library.id);
                                                }
                                            }
                                        }
                                    }

                                    // Click on card to open library
                                    if response.clicked() && library_to_remove.is_none() {
                                        if let Some(pointer_pos) = ui.ctx().pointer_interact_pos() {
                                            if !x_rect.contains(pointer_pos) {
                                                library_to_open = Some(library.path.clone());
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        ui.add_space(30.0);
                        ui.separator();
                        ui.add_space(20.0);
                    }
                }
            }

            // Browse new folder section
            ui.label(egui::RichText::new("Browse New Folder").size(16.0).color(egui::Color32::from_rgb(130, 138, 150)));
            ui.add_space(12.0);

            // Path input - clean design
            ui.horizontal(|ui| {
                let text_edit = egui::TextEdit::singleline(&mut self.path_input)
                    .hint_text("/Volumes/ExternalDrive/Videos")
                    .desired_width(400.0);
                ui.add(text_edit);

                ui.add_space(8.0);

                if ui.button("Browse...").clicked() {
                    if let Some(path) = rfd::FileDialog::new().pick_folder() {
                        self.path_input = path.display().to_string();
                    }
                }
            });

            ui.add_space(16.0);

            // Scan button
            let scan_enabled = !self.path_input.is_empty();
            if ui.add_enabled(scan_enabled, egui::Button::new("Start Scanning")).clicked() {
                let path = PathBuf::from(&self.path_input);
                if path.exists() && path.is_dir() {
                    self.start_scan(path);
                } else {
                    self.state = AppState::Error("Invalid directory path".to_string());
                }
            }

            ui.add_space(40.0);

            // Tip
            ui.label(egui::RichText::new("Tip: Right-click a folder in Finder, hold Option, and select 'Copy as Pathname'")
                .color(egui::Color32::from_rgb(100, 105, 115))
                .small());
        });

        // Handle library open
        if let Some(path) = library_to_open {
            if path.exists() && path.is_dir() {
                self.start_scan(path);
            } else {
                self.state = AppState::Error(format!("Library path not found: {}", path.display()));
            }
        }

        // Handle library removal
        if let Some(id) = library_to_remove {
            if let Some(ref settings) = self.app_settings {
                let _ = settings.remove_library(id);
            }
        }
    }

    fn show_scan_progress(&mut self, ui: &mut egui::Ui) {
        ui.vertical_centered(|ui| {
            ui.add_space(100.0);

            ui.spinner();

            ui.add_space(20.0);
            ui.label(egui::RichText::new("Scanning Videos...").size(20.0).strong());

            // Progress info
            if let Some(progress) = self.scan_progress.lock().unwrap().as_ref() {
                ui.add_space(12.0);

                // Progress bar
                let fraction = if progress.total_videos > 0 {
                    progress.videos_processed as f32 / progress.total_videos as f32
                } else {
                    0.0
                };
                ui.add(egui::ProgressBar::new(fraction).show_percentage());

                ui.add_space(12.0);

                // Stats
                ui.horizontal(|ui| {
                    ui.label(format!("Found: {} videos", progress.total_videos));
                    ui.label(egui::RichText::new(" • ").color(egui::Color32::from_rgb(100, 105, 115)));
                    ui.label(egui::RichText::new(format!("Processed: {}", progress.videos_processed)).color(egui::Color32::from_rgb(99, 140, 255)));
                    ui.label(egui::RichText::new(" • ").color(egui::Color32::from_rgb(100, 105, 115)));
                    ui.label(egui::RichText::new(format!("Cached: {}", progress.videos_skipped)).color(egui::Color32::from_rgb(130, 138, 150)));
                });

                if let Some(current_file) = &progress.current_file {
                    ui.add_space(12.0);
                    ui.label(egui::RichText::new(current_file).color(egui::Color32::from_rgb(100, 105, 115)).small());
                }
            }
        });
    }

    fn show_video_grid(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        // Toolbar with warm styling
        ui.horizontal(|ui| {
            if let Some(path) = &self.current_path {
                if ui.button("📁 Change folder").clicked() {
                    self.state = AppState::SelectDirectory;
                    self.path_input.clear();
                }
                ui.add_space(8.0);
                ui.label(egui::RichText::new(path.display().to_string()).color(egui::Color32::from_rgb(140, 130, 120)));
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                // Clear Cache button
                if ui.button("🗑️ Clear Cache").clicked() {
                    self.show_clear_cache_confirm = true;
                }

                ui.add_space(10.0);

                ui.label(egui::RichText::new(format!("📊 {} videos", self.videos.len())).color(egui::Color32::from_rgb(160, 150, 140)));

                ui.add_space(10.0);

                // Sort dropdown
                let prev_sort = self.sort_option;
                egui::ComboBox::from_label("Sort by")
                    .selected_text(format!("{:?}", self.sort_option))
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.sort_option, SortOption::DateNewest, "📅 Newest First");
                        ui.selectable_value(&mut self.sort_option, SortOption::DateOldest, "📅 Oldest First");
                        ui.selectable_value(&mut self.sort_option, SortOption::DurationLongest, "⏱️ Longest First");
                        ui.selectable_value(&mut self.sort_option, SortOption::DurationShortest, "⏱️ Shortest First");
                        ui.selectable_value(&mut self.sort_option, SortOption::NameAZ, "🔤 Name A-Z");
                        ui.selectable_value(&mut self.sort_option, SortOption::NameZA, "🔤 Name Z-A");
                    });
                // Save if sort option changed
                if self.sort_option != prev_sort {
                    if let Some(ref settings) = self.app_settings {
                        let _ = settings.set_sort_option(&format!("{:?}", self.sort_option));
                    }
                }
            });
        });

        ui.add_space(8.0);
        // Warm separator line
        let sep_rect = ui.available_rect_before_wrap();
        let sep_y = sep_rect.top();
        ui.painter().line_segment(
            [egui::pos2(sep_rect.left(), sep_y), egui::pos2(sep_rect.right(), sep_y)],
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(255, 200, 150, 20)),
        );
        ui.add_space(8.0);

        // Video grid
        if self.videos.is_empty() {
            ui.vertical_centered(|ui| {
                ui.add_space(100.0);
                ui.label(egui::RichText::new("🎬").size(52.0));
                ui.add_space(15.0);
                ui.label(egui::RichText::new("No videos found").size(22.0).strong().color(egui::Color32::WHITE));
                ui.add_space(8.0);
                ui.label(egui::RichText::new("Try selecting a different folder").color(egui::Color32::from_rgb(160, 150, 140)));
            });
        } else {
            // Grid layout
            let available_width = ui.available_width();
            let columns = 4;
            let spacing = 16.0;
            let card_width = (available_width - (spacing * (columns as f32 - 1.0))) / columns as f32;
            let card_height = card_width * 0.75; // 4:3 aspect for card including info

            // Filter videos based on view mode
            let mut videos_clone: Vec<Video> = match self.view_mode {
                ViewMode::AllVideos => self.videos.clone(),
                ViewMode::Favorites => self.videos.iter().filter(|v| v.is_favorite).cloned().collect(),
            };

            // Sort videos based on current sort option
            videos_clone.sort_by(|a, b| match self.sort_option {
                SortOption::DateNewest => b.created_at.cmp(&a.created_at),
                SortOption::DateOldest => a.created_at.cmp(&b.created_at),
                SortOption::DurationLongest => b.duration.partial_cmp(&a.duration).unwrap_or(std::cmp::Ordering::Equal),
                SortOption::DurationShortest => a.duration.partial_cmp(&b.duration).unwrap_or(std::cmp::Ordering::Equal),
                SortOption::NameAZ => a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()),
                SortOption::NameZA => b.file_name.to_lowercase().cmp(&a.file_name.to_lowercase()),
            });

            // We need to track hover state updates
            let mut new_hover_id: Option<String> = None;
            let mut new_hover_pos: f32 = 0.0;
            let mut new_hover_path: Option<PathBuf> = None;
            let mut video_to_open: Option<Video> = None;
            let mut favorite_to_toggle: Option<(String, bool)> = None; // (video_id, new_is_favorite)

            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(spacing, spacing);

                    for video in &videos_clone {
                        let (rect, response) = ui.allocate_exact_size(
                            egui::vec2(card_width, card_height),
                            egui::Sense::click(),
                        );

                        if ui.is_rect_visible(rect) {
                            // Track hover state
                            if response.hovered() {
                                new_hover_id = Some(video.id.clone());
                                new_hover_path = Some(video.file_path.clone());
                                if let Some(pointer_pos) = ctx.pointer_hover_pos() {
                                    let local_x = pointer_pos.x - rect.left();
                                    new_hover_pos = (local_x / rect.width()).clamp(0.0, 1.0);
                                }
                            }

                            // Check for double-click to open modal
                            if response.double_clicked() {
                                video_to_open = Some(video.clone());
                            }

                            let is_hovered = self.hover_video_id.as_ref() == Some(&video.id);
                            let hover_texture = if is_hovered {
                                self.hover_frame_texture.as_ref()
                            } else {
                                None
                            };

                            let buttons = draw_video_card(
                                ui,
                                ctx,
                                rect,
                                video,
                                &response,
                                &mut self.texture_cache,
                                is_hovered,
                                self.hover_position,
                                hover_texture,
                            );

                            // Check if single-click was on any button
                            if response.clicked() {
                                if let Some(pointer_pos) = ctx.pointer_interact_pos() {
                                    tracing::debug!("Click at {:?}, copy_name_rect: {:?}, copy_path_rect: {:?}",
                                        pointer_pos, buttons.copy_name_rect, buttons.copy_path_rect);
                                    if buttons.heart_rect.contains(pointer_pos) {
                                        favorite_to_toggle = Some((video.id.clone(), !video.is_favorite));
                                    } else if buttons.copy_name_rect.map_or(false, |r| r.contains(pointer_pos)) {
                                        tracing::info!("Copy name button clicked!");
                                        copy_to_clipboard(&video.file_name);
                                    } else if buttons.copy_path_rect.map_or(false, |r| r.contains(pointer_pos)) {
                                        tracing::info!("Copy path button clicked!");
                                        copy_to_clipboard(&video.file_path.display().to_string());
                                    }
                                }
                            }
                        }
                    }
                });
            });

            // Update hover state
            if new_hover_id != self.hover_video_id {
                // Hover target changed
                if new_hover_id.is_none() {
                    self.clear_hover_scrub();
                }
            }
            self.hover_video_id = new_hover_id;
            self.hover_position = new_hover_pos;

            // Trigger hover scrub decode if hovering
            if let Some(path) = new_hover_path {
                self.update_hover_scrub(ctx, &path, new_hover_pos);
            }

            // Open video modal if double-clicked
            if let Some(video) = video_to_open {
                self.open_video_modal(&video);
            }

            // Toggle favorite if heart was clicked
            if let Some((video_id, new_is_favorite)) = favorite_to_toggle {
                // Update database
                if let Some(path) = &self.current_path {
                    let db_path = path.join(".vcb-data").join("catalog.db");
                    if let Ok(db) = crate::db::Database::open(&db_path) {
                        let _ = crate::db::toggle_favorite(db.conn(), &video_id, new_is_favorite);
                    }
                }
                // Update local state
                if let Some(video) = self.videos.iter_mut().find(|v| v.id == video_id) {
                    video.is_favorite = new_is_favorite;
                }
            }
        }
    }

    fn show_error(&mut self, ui: &mut egui::Ui, msg: String) {
        ui.vertical_centered(|ui| {
            ui.add_space(100.0);
            ui.label(egui::RichText::new("⚠").size(48.0).color(egui::Color32::from_rgb(240, 80, 80)));
            ui.add_space(12.0);
            ui.label(egui::RichText::new("Error").size(20.0).strong());
            ui.add_space(8.0);
            ui.label(egui::RichText::new(&msg).color(egui::Color32::from_rgb(130, 138, 150)));
            ui.add_space(20.0);
            if ui.button("Try Again").clicked() {
                self.state = AppState::SelectDirectory;
            }
        });
    }

    /// Render video player modal - clean minimal design
    fn render_video_modal(&mut self, ctx: &egui::Context) {
        if !self.show_video_modal {
            return;
        }

        let selected_video = match &self.selected_video {
            Some(v) => v.clone(),
            None => return,
        };

        // Track if close button was clicked
        let mut should_close = false;

        egui::Window::new("Video Player")
            .collapsible(false)
            .resizable(true)
            .default_size([900.0, 580.0])
            .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
            .show(ctx, |ui| {
                // Top bar with title and close button
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new(&selected_video.file_name).strong());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("✕ Close").clicked() {
                            should_close = true;
                        }
                    });
                });

                ui.add_space(8.0);

                // Video display area
                let available_width = ui.available_width();
                let video_height = available_width * 0.5625; // 16:9

                let (video_rect, _) = ui.allocate_exact_size(
                    egui::vec2(available_width, video_height),
                    egui::Sense::click(),
                );

                // Draw video frame or placeholder
                {
                    let painter = ui.painter();
                    if let Some(texture) = &self.player_texture {
                        painter.image(
                            texture.id(),
                            video_rect,
                            egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
                            egui::Color32::WHITE,
                        );
                    } else {
                        painter.rect_filled(video_rect, 4.0, egui::Color32::from_rgb(20, 22, 26));
                        painter.text(
                            video_rect.center(),
                            egui::Align2::CENTER_CENTER,
                            "Loading...",
                            egui::FontId::proportional(14.0),
                            egui::Color32::from_rgb(130, 138, 150),
                        );
                    }
                }

                ui.add_space(10.0);

                // Controls bar
                ui.horizontal(|ui| {
                    // Play/Pause button
                    let is_playing = self.video_player.as_ref().map(|p| p.is_playing()).unwrap_or(false);
                    let play_text = if is_playing { "⏸ Pause" } else { "▶ Play" };
                    if ui.button(play_text).clicked() {
                        if let Some(player) = &mut self.video_player {
                            player.toggle_playback();
                        }
                    }

                    // Seek slider
                    let mut position = self.video_player.as_ref().map(|p| p.current_position()).unwrap_or(0.0) as f32;
                    let slider = egui::Slider::new(&mut position, 0.0..=1.0)
                        .show_value(false)
                        .trailing_fill(true);
                    if ui.add_sized([ui.available_width() - 100.0, 20.0], slider).changed() {
                        if let Some(player) = &mut self.video_player {
                            player.seek(position as f64);
                        }
                    }

                    // Time display
                    let current_time = self.video_player.as_ref().map(|p| p.current_time()).unwrap_or(0.0);
                    let duration = self.video_player.as_ref().map(|p| p.duration()).unwrap_or(0.0);
                    ui.label(egui::RichText::new(format!("{} / {}", format_duration(current_time), format_duration(duration)))
                        .color(egui::Color32::from_rgb(130, 138, 150)));
                });

                ui.add_space(6.0);

                // File info
                ui.label(egui::RichText::new(format_file_size(selected_video.file_size))
                    .color(egui::Color32::from_rgb(130, 138, 150))
                    .small());
            });

        // Handle close
        if should_close {
            self.close_video_modal();
        }

        // Handle escape key to close modal
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.close_video_modal();
        }
    }

    /// Close video modal and clean up
    fn close_video_modal(&mut self) {
        self.show_video_modal = false;
        self.video_player = None;
        self.player_texture = None;
        self.selected_video = None;
    }

    /// Open video in modal player
    fn open_video_modal(&mut self, video: &Video) {
        self.selected_video = Some(video.clone());
        self.show_video_modal = true;

        // Create video player
        match VideoPlayer::new(&video.file_path) {
            Ok(mut player) => {
                player.play(); // Auto-play
                self.video_player = Some(player);
            }
            Err(e) => {
                eprintln!("Failed to open video player: {}", e);
                // Fallback to system player
                let _ = std::process::Command::new("open")
                    .arg(&video.file_path)
                    .spawn();
                self.show_video_modal = false;
            }
        }
    }

    /// Update player frame texture from video player
    fn update_player_frame(&mut self, ctx: &egui::Context) {
        if let Some(player) = &mut self.video_player {
            if let Some(frame) = player.get_frame() {
                let color_image = egui::ColorImage::from_rgba_unmultiplied(
                    [frame.width as usize, frame.height as usize],
                    &frame.data,
                );
                self.player_texture = Some(ctx.load_texture(
                    "player_frame",
                    color_image,
                    egui::TextureOptions::LINEAR,
                ));
            }
        }
    }

    /// Handle hover scrubbing - request frame decode in background (non-blocking)
    fn update_hover_scrub(&mut self, ctx: &egui::Context, video_path: &PathBuf, position: f32) {
        // Check if video changed
        let video_changed = match &self.hover_video_path {
            Some(path) => path != video_path,
            None => true,
        };

        if video_changed {
            self.hover_video_path = Some(video_path.clone());
            self.last_hover_position = -1.0;
            self.hover_frame_texture = None;
            self.hover_decoder.clear_pending();
        }

        // Only request decode if position changed significantly (>5%)
        // This reduces decode requests from 60/sec to ~6/sec during fast scrubbing
        if (position - self.last_hover_position).abs() > 0.05 {
            self.last_hover_position = position;
            // Non-blocking: just sends request to background thread
            self.hover_decoder.request_frame(video_path, position);
        }

        // Poll for decoded frames (non-blocking)
        if let Some(frame) = self.hover_decoder.poll_frame() {
            // Only update texture if this frame is for the current video
            if Some(&frame.video_path) == self.hover_video_path.as_ref() {
                let color_image = egui::ColorImage::from_rgba_unmultiplied(
                    [frame.width as usize, frame.height as usize],
                    &frame.rgba_data,
                );
                self.hover_frame_texture = Some(ctx.load_texture(
                    "hover_frame",
                    color_image,
                    egui::TextureOptions::LINEAR,
                ));
            }
        }
    }

    /// Clear hover scrub state
    fn clear_hover_scrub(&mut self) {
        self.hover_video_id = None;
        self.hover_video_path = None;
        self.hover_decoder.clear_pending();
        self.hover_frame_texture = None;
        self.last_hover_position = -1.0;
    }
}

/// Button rects returned from draw_video_card for click detection
struct CardButtons {
    heart_rect: egui::Rect,
    copy_name_rect: Option<egui::Rect>,
    copy_path_rect: Option<egui::Rect>,
}

/// UI constants for consistent styling
const CARD_ROUNDING: f32 = 8.0;

/// Draw a video card with thumbnail
/// Returns the rects of interactive buttons for click detection
fn draw_video_card(
    ui: &mut egui::Ui,
    ctx: &egui::Context,
    rect: egui::Rect,
    video: &Video,
    response: &egui::Response,
    texture_cache: &mut crate::cache::TextureCache,
    is_hovered: bool,
    hover_position: f32,
    hover_texture: Option<&egui::TextureHandle>,
) -> CardButtons {
    let painter = ui.painter();

    // Clean card background
    let bg_color = if response.hovered() {
        egui::Color32::from_rgb(32, 36, 44)
    } else {
        egui::Color32::from_rgb(24, 27, 33)
    };

    let border_color = if response.hovered() {
        egui::Color32::from_rgb(99, 140, 255)
    } else {
        egui::Color32::from_rgb(45, 50, 60)
    };

    painter.rect_filled(rect, CARD_ROUNDING, bg_color);
    painter.rect_stroke(rect, CARD_ROUNDING, egui::Stroke::new(1.0, border_color));

    // Thumbnail area (top portion)
    let thumb_height = rect.width() * 0.5625; // 16:9 aspect
    let thumb_rect = egui::Rect::from_min_size(rect.min, egui::vec2(rect.width(), thumb_height));

    // Display hover frame or thumbnail
    let mut thumbnail_displayed = false;

    // If hovering and we have a decoded frame, show it
    if is_hovered {
        if let Some(hover_tex) = hover_texture {
            painter.image(
                hover_tex.id(),
                thumb_rect,
                egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
                egui::Color32::WHITE,
            );
            thumbnail_displayed = true;
        }
    }

    // Fall back to static thumbnail if not showing hover frame
    if !thumbnail_displayed {
        if let Some(thumb_path) = &video.thumbnail_path {
            if let Some(texture) = texture_cache.get_or_load(ctx, &video.id, thumb_path) {
                // Draw the thumbnail image
                painter.image(
                    texture.id(),
                    thumb_rect,
                    egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
                    egui::Color32::WHITE,
                );
                thumbnail_displayed = true;
            }
        }
    }

    // Fallback: clean placeholder if no thumbnail
    if !thumbnail_displayed {
        painter.rect_filled(
            thumb_rect,
            egui::Rounding { nw: CARD_ROUNDING, ne: CARD_ROUNDING, sw: 0.0, se: 0.0 },
            egui::Color32::from_rgb(20, 22, 26),
        );
        // Draw play icon in center
        let center = thumb_rect.center();
        painter.circle_filled(center, 22.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 120));
        painter.text(
            center,
            egui::Align2::CENTER_CENTER,
            "▶",
            egui::FontId::proportional(16.0),
            egui::Color32::from_rgb(130, 138, 150),
        );
    }

    // Show time indicator if hovering
    if is_hovered && thumbnail_displayed {
        // Progress bar at bottom of thumbnail
        let progress_height = 3.0;
        let progress_rect = egui::Rect::from_min_size(
            egui::pos2(thumb_rect.left(), thumb_rect.bottom() - progress_height),
            egui::vec2(thumb_rect.width(), progress_height),
        );
        painter.rect_filled(progress_rect, 0.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 120));

        let filled_width = thumb_rect.width() * hover_position;
        let filled_rect = egui::Rect::from_min_size(
            progress_rect.min,
            egui::vec2(filled_width, progress_height),
        );
        painter.rect_filled(filled_rect, 0.0, egui::Color32::from_rgb(99, 140, 255)); // Blue accent

        // Time indicator overlay
        let current_time = video.duration * hover_position as f64;
        let time_text = format_duration(current_time);
        let time_galley = painter.layout_no_wrap(
            time_text,
            egui::FontId::proportional(11.0),
            egui::Color32::WHITE,
        );
        let time_rect = egui::Rect::from_min_size(
            egui::pos2(
                thumb_rect.center().x - time_galley.size().x / 2.0 - 6.0,
                thumb_rect.bottom() - 28.0,
            ),
            egui::vec2(time_galley.size().x + 12.0, time_galley.size().y + 6.0),
        );
        painter.rect_filled(time_rect, 4.0, egui::Color32::from_rgba_unmultiplied(15, 17, 21, 230));
        painter.galley(
            egui::pos2(time_rect.left() + 6.0, time_rect.top() + 3.0),
            time_galley,
            egui::Color32::WHITE,
        );
    }

    // Duration badge (always show) - clean styling
    let duration_text = format_duration(video.duration);
    let duration_pos = egui::pos2(thumb_rect.right() - 8.0, thumb_rect.bottom() - 8.0);
    let text_galley = painter.layout_no_wrap(
        duration_text,
        egui::FontId::proportional(10.0),
        egui::Color32::WHITE,
    );
    let badge_rect = egui::Rect::from_min_size(
        egui::pos2(
            duration_pos.x - text_galley.size().x - 8.0,
            duration_pos.y - text_galley.size().y - 4.0,
        ),
        egui::vec2(text_galley.size().x + 8.0, text_galley.size().y + 4.0),
    );
    painter.rect_filled(badge_rect, 4.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 180));
    painter.galley(
        egui::pos2(badge_rect.left() + 4.0, badge_rect.top() + 2.0),
        text_galley,
        egui::Color32::WHITE,
    );

    // Info section
    let info_rect = egui::Rect::from_min_max(
        egui::pos2(rect.left() + 10.0, thumb_rect.bottom() + 8.0),
        egui::pos2(rect.right() - 10.0, rect.bottom() - 8.0),
    );

    // File name
    let name_galley = painter.layout(
        video.file_name.clone(),
        egui::FontId::proportional(11.0),
        egui::Color32::from_rgb(240, 242, 245),
        info_rect.width(),
    );
    painter.galley(info_rect.left_top(), name_galley, egui::Color32::from_rgb(240, 242, 245));

    // File size and date
    let meta_text = format!(
        "{} • {}",
        format_file_size(video.file_size),
        video.created_at.format("%m/%d/%Y")
    );
    let meta_galley = painter.layout_no_wrap(
        meta_text,
        egui::FontId::proportional(10.0),
        egui::Color32::from_rgb(130, 138, 150),
    );
    painter.galley(
        egui::pos2(info_rect.left(), info_rect.top() + 16.0),
        meta_galley,
        egui::Color32::from_rgb(130, 138, 150),
    );

    // Favorite heart button (top-left of thumbnail)
    let heart_size = 24.0;
    let heart_margin = 8.0;
    let heart_rect = egui::Rect::from_min_size(
        egui::pos2(thumb_rect.left() + heart_margin, thumb_rect.top() + heart_margin),
        egui::vec2(heart_size, heart_size),
    );

    // Background for heart button
    painter.rect_filled(heart_rect, 4.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 150));

    // Heart icon
    let heart_center = heart_rect.center();
    if video.is_favorite {
        painter.text(
            heart_center,
            egui::Align2::CENTER_CENTER,
            "♥",
            egui::FontId::proportional(14.0),
            egui::Color32::from_rgb(240, 80, 80),
        );
    } else {
        painter.text(
            heart_center,
            egui::Align2::CENTER_CENTER,
            "♡",
            egui::FontId::proportional(14.0),
            egui::Color32::from_rgb(130, 138, 150),
        );
    }

    // Copy buttons (top-right of thumbnail) - always compute rects for click detection
    let button_size = 24.0;
    let button_spacing = 4.0;
    let copy_margin = 8.0;

    // Copy path button (rightmost)
    let copy_path_button = egui::Rect::from_min_size(
        egui::pos2(
            thumb_rect.right() - copy_margin - button_size,
            thumb_rect.top() + copy_margin,
        ),
        egui::vec2(button_size, button_size),
    );

    // Copy name button (next to path button)
    let copy_name_button = egui::Rect::from_min_size(
        egui::pos2(
            copy_path_button.left() - button_spacing - button_size,
            thumb_rect.top() + copy_margin,
        ),
        egui::vec2(button_size, button_size),
    );

    // Only draw visually when hovered
    if is_hovered {
        // Draw backgrounds
        painter.rect_filled(copy_name_button, 4.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 150));
        painter.rect_filled(copy_path_button, 4.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 150));

        // Copy name icon
        painter.text(
            copy_name_button.center(),
            egui::Align2::CENTER_CENTER,
            "📋",
            egui::FontId::proportional(11.0),
            egui::Color32::WHITE,
        );

        // Copy path icon
        painter.text(
            copy_path_button.center(),
            egui::Align2::CENTER_CENTER,
            "📁",
            egui::FontId::proportional(11.0),
            egui::Color32::WHITE,
        );
    }

    // Always provide rects for click detection
    let copy_name_rect = Some(copy_name_button);
    let copy_path_rect = Some(copy_path_button);

    // Return all button rects for click detection
    CardButtons {
        heart_rect,
        copy_name_rect,
        copy_path_rect,
    }
}

/// Format duration as MM:SS or HH:MM:SS
fn format_duration(seconds: f64) -> String {
    let total_secs = seconds as u64;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let secs = total_secs % 60;

    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

/// Format file size
fn format_file_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Copy text to clipboard
fn copy_to_clipboard(text: &str) {
    tracing::info!("Copying to clipboard: {}", text);
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => {
            match clipboard.set_text(text.to_string()) {
                Ok(_) => tracing::info!("Successfully copied to clipboard"),
                Err(e) => tracing::error!("Failed to set clipboard text: {}", e),
            }
        }
        Err(e) => tracing::error!("Failed to create clipboard: {}", e),
    }
}
