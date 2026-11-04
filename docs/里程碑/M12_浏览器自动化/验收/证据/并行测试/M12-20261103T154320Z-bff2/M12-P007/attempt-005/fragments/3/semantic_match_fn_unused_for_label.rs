    let match_fn = if exact {
        format!(
            "el.textContent.trim() === {}",
            serde_json::to_string(value).unwrap_or_default()
        )
    } else {
        format!(
            "el.textContent.includes({})",
            serde_json::to_string(value).unwrap_or_default()
        )
    };

