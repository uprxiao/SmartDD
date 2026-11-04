    let result: super::cdp::types::EvaluateResult = mgr
        .client
        .send_command_typed(
            "Runtime.evaluate",
            &super::cdp::types::EvaluateParams {
                expression: query,
                return_by_value: Some(true),
                await_promise: Some(false),
            },
            Some(&session_id),
        )
        .await?;

    if !result
        .result
        .value
        .as_ref()
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(format!("No element found by {} '{}'", strategy, value));
    }

    let selector = "[data-agent-browser-located='true']";
    let action_result = execute_subaction(cmd, state, selector).await;

    if let Some(ref browser) = state.browser {
        let _ = browser
            .evaluate(
                "document.querySelector('[data-agent-browser-located]')?.removeAttribute('data-agent-browser-located')",
                None,
            )
            .await;
    }

    action_result
}