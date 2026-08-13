# Markdown kitchen sink

This fixture exercises **strong text**, *emphasis*, ~~deleted text~~,
`inline code`, an escaped \*asterisk\*, an &amp; entity, an
[external link](https://example.com), and a footnote reference.[^source]

## Lists and quotations

- First item
  - Nested item with a [relative document](chapter-two.md)
- [x] Completed task
- [ ] Open task

> A blockquote
>
> > with a nested quotation.

### Table

| Alignment | Example |
| :--- | ---: |
| Left | 12 |
| Unicode | 😀 |

#### Code

```python
review = "source-backed"
```

##### Mathematics

Inline math uses $E = mc^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

###### Remaining blocks

---

![A local example image](assets/example.png "Example title")

Hard-wrapped source remains one paragraph
unless Markdown explicitly requests a break.  
This line follows a hard break.

[^source]: Footnotes render with working in-document reference and return links.
