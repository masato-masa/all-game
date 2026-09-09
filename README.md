# パズルゲーム棚

つくったパズルゲームの一覧ページ。表紙を押すと、GitHub Pages で公開中の各ゲームがそのまま開く。

公開先: https://masato-masa.github.io/all-game/

| ゲーム | 遊ぶ | リポジトリ |
| --- | --- | --- |
| 動物パズル | https://masato-masa.github.io/animal-puzzle/ | [animal-puzzle](https://github.com/masato-masa/animal-puzzle) |
| ヘビパズル | https://masato-masa.github.io/snake-puzzle/ | [snake-puzzle](https://github.com/masato-masa/snake-puzzle) |
| 数式パズル | https://masato-masa.github.io/math-puzzle/ | [math-puzzle](https://github.com/masato-masa/math-puzzle) |
| ねこめいろ | https://masato-masa.github.io/cat-maze/ | [cat-maze](https://github.com/masato-masa/cat-maze) |
| アルバム（ゲームではない） | https://masato-masa.github.io/7242/ | [7242](https://github.com/masato-masa/7242) |

`index.html` 1枚だけの静的ページ。表紙の画像は各サイトを実際に開いて切り出したもので、
data URI として HTML に埋め込んである（外部リクエストはフォントのみ）。
ゲームを増やしたら `.shelf` の中にエントリを1つ足す。
