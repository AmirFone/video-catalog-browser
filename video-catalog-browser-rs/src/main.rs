#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod ui;
mod db;
mod scanner;
mod video;
mod cache;
mod settings;

use app::VideoCatalogApp;
use eframe::egui;

fn main() -> eframe::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1400.0, 900.0])
            .with_min_inner_size([800.0, 600.0])
            .with_title("Video Catalog Browser"),
        ..Default::default()
    };

    eframe::run_native(
        "Video Catalog Browser",
        options,
        Box::new(|cc| {
            // Configure dark theme
            setup_custom_style(&cc.egui_ctx);

            // Load image loaders for egui
            egui_extras::install_image_loaders(&cc.egui_ctx);

            Ok(Box::new(VideoCatalogApp::new(cc)))
        }),
    )
}

fn setup_custom_style(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();

    // Clean minimal dark palette - slate blue-gray
    let bg_dark = egui::Color32::from_rgb(15, 17, 21);         // Deep slate
    let bg_card = egui::Color32::from_rgb(24, 27, 33);         // Card background
    let bg_card_hover = egui::Color32::from_rgb(32, 36, 44);   // Hover state
    let border = egui::Color32::from_rgb(45, 50, 60);          // Subtle border
    let text = egui::Color32::from_rgb(240, 242, 245);         // Off-white
    let text_muted = egui::Color32::from_rgb(130, 138, 150);   // Muted gray
    let accent = egui::Color32::from_rgb(99, 140, 255);        // Soft blue accent

    // Apply colors to visuals
    style.visuals.dark_mode = true;
    style.visuals.panel_fill = bg_dark;
    style.visuals.window_fill = egui::Color32::from_rgb(22, 25, 30);
    style.visuals.extreme_bg_color = bg_dark;
    style.visuals.faint_bg_color = bg_card;

    style.visuals.widgets.noninteractive.bg_fill = bg_card;
    style.visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, text);
    style.visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, border);
    style.visuals.widgets.noninteractive.rounding = egui::Rounding::same(8.0);

    style.visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(35, 40, 50);
    style.visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, text_muted);
    style.visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, border);
    style.visuals.widgets.inactive.rounding = egui::Rounding::same(8.0);

    style.visuals.widgets.hovered.bg_fill = bg_card_hover;
    style.visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, text);
    style.visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, accent);
    style.visuals.widgets.hovered.rounding = egui::Rounding::same(8.0);

    style.visuals.widgets.active.bg_fill = egui::Color32::from_rgb(45, 52, 65);
    style.visuals.widgets.active.fg_stroke = egui::Stroke::new(1.0, text);
    style.visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0, accent);
    style.visuals.widgets.active.rounding = egui::Rounding::same(8.0);

    style.visuals.selection.bg_fill = accent.linear_multiply(0.25);
    style.visuals.selection.stroke = egui::Stroke::new(1.0, accent);

    // Clean rounded corners
    style.visuals.window_rounding = egui::Rounding::same(12.0);
    style.visuals.menu_rounding = egui::Rounding::same(8.0);

    // Subtle window shadow
    style.visuals.window_shadow = egui::Shadow {
        offset: egui::vec2(0.0, 4.0),
        blur: 16.0,
        spread: 0.0,
        color: egui::Color32::from_rgba_unmultiplied(0, 0, 0, 80),
    };

    // Popup shadow
    style.visuals.popup_shadow = egui::Shadow {
        offset: egui::vec2(0.0, 2.0),
        blur: 12.0,
        spread: 0.0,
        color: egui::Color32::from_rgba_unmultiplied(0, 0, 0, 60),
    };

    // Spacing
    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.window_margin = egui::Margin::same(16.0);
    style.spacing.button_padding = egui::vec2(14.0, 6.0);

    ctx.set_style(style);
}
