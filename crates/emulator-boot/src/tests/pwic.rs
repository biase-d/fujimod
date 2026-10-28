use super::*;

#[test]
fn capture_power_register_is_declared_for_both_native_and_browser_runs() {
    for overlays in [vec![], vec!["x70-110-browser-camera".into()]] {
        let prepared = prepare("x70-110-rec", &overlays).unwrap();
        let parts = &model(&prepared, "control_bus1")["options"]["parts"];
        assert!(
            parts["pwic_values"]
                .as_array()
                .unwrap()
                .contains(&json!([1, 0]))
        );
        assert!(
            parts["pwic_masks"]
                .as_array()
                .unwrap()
                .contains(&json!([1, 0x1f]))
        );
        assert!(
            parts["pwic_read_prefixes"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row[0] != 1)
        );
    }
}
