use crate::error::AppResult;
use pinyin::ToPinyin;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinyinInitialsArgs {
    pub titles: Vec<String>,
}

#[tauri::command]
pub fn command_pinyin_initials(args: PinyinInitialsArgs) -> AppResult<Vec<String>> {
    Ok(args.titles.iter().map(|title| initials(title)).collect())
}

pub(crate) fn initials(title: &str) -> String {
    let mut result = String::with_capacity(title.len());
    for (character, sound) in title.chars().zip(title.to_pinyin()) {
        match sound {
            Some(sound) => result.extend(
                sound
                    .plain()
                    .chars()
                    .next()
                    .unwrap_or(character)
                    .to_lowercase(),
            ),
            None => result.extend(character.to_lowercase()),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_chinese_to_pinyin_initials_and_keeps_latin_text() {
        assert_eq!(initials("保存"), "bc");
        assert_eq!(initials("保存 File"), "bc file");
    }
}
