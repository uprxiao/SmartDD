    let match_fn = if exact {
        format!(
            "textOf(el).trim() === {}",
            serde_json::to_string(value).unwrap_or_default()
        )
    } else {
        format!(
            "textOf(el).includes({})",
            serde_json::to_string(value).unwrap_or_default()
        )
    };

