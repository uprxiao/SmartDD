        "label" => {
            let value_json = serde_json::to_string(value).unwrap_or_default();
            let matches_fn = if exact {
                format!("(s) => !!s && s.trim() === {value_json}")
            } else {
                format!("(s) => !!s && s.includes({value_json})")
            };
            format!(
                r#"(() => {{
                const matches = {matches_fn};
                const label = Array.from(document.querySelectorAll('label')).find(el => matches(el.textContent));
                if (label) {{
                    const forId = label.getAttribute('for');
                    const target = forId ? document.getElementById(forId) : label.querySelector('input,select,textarea');
                    if (target) {{ target.setAttribute('data-agent-browser-located', 'true'); return true; }}
                }}
                const aria = Array.from(document.querySelectorAll('[aria-label]')).find(el => matches(el.getAttribute('aria-label')));
                if (aria) {{ aria.setAttribute('data-agent-browser-located', 'true'); return true; }}
                const referenced = Array.from(document.querySelectorAll('[aria-labelledby]')).find(el => {{
                    const text = el.getAttribute('aria-labelledby').split(/\s+/)
                        .map(id => {{ const r = document.getElementById(id); return r ? r.textContent : ''; }})
                        .join(' ');
                    return matches(text);
                }});
                if (referenced) {{ referenced.setAttribute('data-agent-browser-located', 'true'); return true; }}
                return false;
            }})()"#,
            )
        }