# Processors and Developing new Processors

A key concept of otel-light are processors. These are modules that can be added to hande new type of URL.

Built-in processors are stored in the [otel-light-server/processors-system](../../otel-light-server/processors-system/) of thise repository.

However, users can implement their own processors wihout changing the application.

Do do so you need to create a Javascript file in the `/opt/app/otel-light/processors-user` of the runtime container

Processors are used in alphabetical order. It is then recommended to name processors from the most specific to the more general.

The provided Javascript files need to follow the following structure:

```javascript
module.exports = {
  //
  getInfo: () => {
    return {
      title: "<NAME OF THE PROCESSOR>",
      description: "<SOME DESCRIPTION ABOUT THE PROCESSOR>",
      icon: "<A THE BOOTSTRAP ICON CODE>",
    };
  },

  test: async (source) => {
    let urlMatch = /.../.exec(source.info.url); // A REGEX TO TEST IF THE URL IS SUPPORTED
    if (urlMatch) {
      return { name: "<NAME FOR THE SOURCE>", icon: "<A THE BOOTSTRAP ICON CODE>" };
    }
    return null; // URL NOT SUPPORTED
  },

  fetchLatest: async (source, lastSourceItemSaved) => {
    // lastSourceItemSaved IS THE LAST ITEM KNOWN FOR THIS SOURCE

    // RETURN THE FOLLOWING ARRAY:
    const sourceItems = [
        {
            url = "<URL OF THE ITEM>",
            title = "TITLE OF THE ITEM",
            content = "TEXT OF THE ITEM",
            datePublished = new Date("<DATE OF THE ITEM>");
        },
        ...
    ];
    return sourceItems;
  },
};
```

It is recommenede to have a look at the existing [System Processors](../../otel-light-server/processors-system/).
